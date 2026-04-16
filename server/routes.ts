import type { Express, RequestHandler } from "express";
import express from "express";
import path from "path";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertClientSchema, 
  insertLocationSchema, 
  insertCameraSchema,
  insertTimelapseSchema,
  insertClientAccountSchema,
  insertAdminAccountSchema,
} from "@shared/schema";
import { z } from "zod";
import { testCameraConnection, fetchSnapshot, testGo2rtcConnection, isSafeTarget } from "./camera-service";
import { sendWelcomeEmail, sendPasswordResetEmail, sendNewTicketEmail, sendAdminWelcomeEmail } from "./email-service";
import { getClientIp } from "./client-ip";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import archiver from "archiver";
import crypto from "crypto";
import { db } from "./db";
import { captures, timelapses } from "@shared/schema";
import { sql } from "drizzle-orm";
import { audit } from "./audit";

declare global {
  namespace Express {
    interface Request {
      clientAccountId?: string;
      adminAccountId?: string;
    }
  }
}

const CLIENT_JWT_SECRET = process.env.SESSION_SECRET! + "_client";
const ADMIN_JWT_SECRET = process.env.SESSION_SECRET! + "_admin";

// Rate limiting for login endpoints.
// Duas camadas: (1) por IP+email — impede brute force em uma conta específica,
// (2) por IP puro — impede password spray entre muitos emails.
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 5;         // 5 erros por IP+email em 15 min
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;

const ipLoginAttempts = new Map<string, { count: number; resetAt: number }>();
const IP_RATE_LIMIT_MAX = 50;     // 50 erros TOTAL por IP em 1 hora
const IP_RATE_LIMIT_WINDOW = 60 * 60 * 1000;

function loginKey(ip: string, email?: string): string {
  return email ? `${ip}|${email.toLowerCase()}` : ip;
}

// Returns true if allowed to attempt login. Checks BOTH layers.
function checkRateLimit(ip: string, email?: string): boolean {
  const now = Date.now();
  // Layer 1: per IP+email
  const entry = loginAttempts.get(loginKey(ip, email));
  if (entry && now <= entry.resetAt && entry.count >= RATE_LIMIT_MAX) return false;
  // Layer 2: per IP (anti password spray)
  const ipEntry = ipLoginAttempts.get(ip);
  if (ipEntry && now <= ipEntry.resetAt && ipEntry.count >= IP_RATE_LIMIT_MAX) return false;
  return true;
}

// Call on a FAILED login to increment both counters.
function recordFailedLogin(ip: string, email?: string): void {
  const now = Date.now();
  // Layer 1: per IP+email
  const key = loginKey(ip, email);
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
  } else {
    entry.count++;
  }
  // Layer 2: per IP
  const ipEntry = ipLoginAttempts.get(ip);
  if (!ipEntry || now > ipEntry.resetAt) {
    ipLoginAttempts.set(ip, { count: 1, resetAt: now + IP_RATE_LIMIT_WINDOW });
  } else {
    ipEntry.count++;
  }
}

// Call on a SUCCESSFUL login to reset per-email counter (NOT per-IP).
function resetRateLimit(ip: string, email?: string): void {
  loginAttempts.delete(loginKey(ip, email));
}

// Separate bucket for forgot/reset password — keyed by IP only, so these
// endpoints cannot drain (or be drained by) the login budget.
const resetAttempts = new Map<string, { count: number; resetAt: number }>();
function checkResetRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = resetAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    resetAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// Rate limiting for change-password (keyed by accountId — independent of login rate limit
// so it cannot be bypassed by making a successful login to reset the IP counter)
const changePasswordAttempts = new Map<string, { count: number; resetAt: number }>();
const CHANGE_PASSWORD_MAX = 5;
const CHANGE_PASSWORD_WINDOW = 15 * 60 * 1000; // 15 minutes

function checkChangePasswordRateLimit(accountId: string): boolean {
  const now = Date.now();
  const entry = changePasswordAttempts.get(accountId);
  if (!entry || now > entry.resetAt) {
    changePasswordAttempts.set(accountId, { count: 1, resetAt: now + CHANGE_PASSWORD_WINDOW });
    return true;
  }
  if (entry.count >= CHANGE_PASSWORD_MAX) return false;
  entry.count++;
  return true;
}

// Rate limit para criação de tickets de suporte (keyed por clientAccountId).
// Impede "email bomb" contra o admin — cada ticket novo dispara um email.
const ticketCreateAttempts = new Map<string, { count: number; resetAt: number }>();
const TICKET_CREATE_MAX = 5;
const TICKET_CREATE_WINDOW = 60 * 60 * 1000; // 1 hora

function checkTicketCreateRateLimit(accountId: string): boolean {
  const now = Date.now();
  const entry = ticketCreateAttempts.get(accountId);
  if (!entry || now > entry.resetAt) {
    ticketCreateAttempts.set(accountId, { count: 1, resetAt: now + TICKET_CREATE_WINDOW });
    return true;
  }
  if (entry.count >= TICKET_CREATE_MAX) return false;
  entry.count++;
  return true;
}

// Rate limit para mensagens em tickets (keyed por clientAccountId).
// Evita spam de mensagens num ticket e DB flood. 30/hora cobre conversas reais.
const ticketMessageAttempts = new Map<string, { count: number; resetAt: number }>();
const TICKET_MESSAGE_MAX = 30;
const TICKET_MESSAGE_WINDOW = 60 * 60 * 1000; // 1 hora

function checkTicketMessageRateLimit(accountId: string): boolean {
  const now = Date.now();
  const entry = ticketMessageAttempts.get(accountId);
  if (!entry || now > entry.resetAt) {
    ticketMessageAttempts.set(accountId, { count: 1, resetAt: now + TICKET_MESSAGE_WINDOW });
    return true;
  }
  if (entry.count >= TICKET_MESSAGE_MAX) return false;
  entry.count++;
  return true;
}

// Cleanup expired entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(ip);
  }
  for (const [ip, entry] of ipLoginAttempts) {
    if (now > entry.resetAt) ipLoginAttempts.delete(ip);
  }
  for (const [ip, entry] of resetAttempts) {
    if (now > entry.resetAt) resetAttempts.delete(ip);
  }
  for (const [id, entry] of changePasswordAttempts) {
    if (now > entry.resetAt) changePasswordAttempts.delete(id);
  }
  for (const [id, entry] of ticketCreateAttempts) {
    if (now > entry.resetAt) ticketCreateAttempts.delete(id);
  }
  for (const [id, entry] of ticketMessageAttempts) {
    if (now > entry.resetAt) ticketMessageAttempts.delete(id);
  }
}, 30 * 60 * 1000);

export const isAdminAuthenticated: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.["skylapse-admin-token"];
  if (!token) {
    return res.status(401).json({ message: "Não autenticado" });
  }
  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET) as { adminAccountId: string; tv?: number };
    const account = await storage.getAdminAccount(payload.adminAccountId);
    if (!account) {
      res.clearCookie("skylapse-admin-token");
      return res.status(401).json({ message: "Conta não encontrada ou removida" });
    }
    // Reject tokens issued before the last logout or password change
    if ((payload.tv ?? 0) !== (account.tokenVersion ?? 0)) {
      res.clearCookie("skylapse-admin-token");
      return res.status(401).json({ message: "Sessão inválida. Faça login novamente." });
    }
    req.adminAccountId = payload.adminAccountId;
    next();
  } catch {
    return res.status(401).json({ message: "Sessão expirada ou inválida" });
  }
};

export const isClientAuthenticated: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.["skylapse-client-token"];
  if (!token) {
    return res.status(401).json({ message: "Não autenticado" });
  }
  try {
    const payload = jwt.verify(token, CLIENT_JWT_SECRET) as { clientAccountId: string; tv?: number };
    const account = await storage.getClientAccount(payload.clientAccountId);
    if (!account || account.status !== "ativo") {
      res.clearCookie("skylapse-client-token");
      return res.status(401).json({ message: "Conta inativa ou não encontrada" });
    }
    // Reject tokens issued before the last logout or password change
    if ((payload.tv ?? 0) !== (account.tokenVersion ?? 0)) {
      res.clearCookie("skylapse-client-token");
      return res.status(401).json({ message: "Sessão inválida. Faça login novamente." });
    }
    req.clientAccountId = payload.clientAccountId;
    next();
  } catch {
    return res.status(401).json({ message: "Sessão expirada ou inválida" });
  }
};

// Accepts either admin OR client token — used for shared resources (captures, videos)
const isAnyAuthenticated: RequestHandler = async (req, res, next) => {
  const adminToken = req.cookies?.["skylapse-admin-token"];
  const clientToken = req.cookies?.["skylapse-client-token"];

  if (adminToken) {
    try {
      const payload = jwt.verify(adminToken, ADMIN_JWT_SECRET) as { adminAccountId: string; tv?: number };
      const account = await storage.getAdminAccount(payload.adminAccountId);
      if (account && (payload.tv ?? 0) === (account.tokenVersion ?? 0)) {
        req.adminAccountId = payload.adminAccountId;
        return next();
      }
    } catch { /* fall through to client check */ }
  }

  if (clientToken) {
    try {
      const payload = jwt.verify(clientToken, CLIENT_JWT_SECRET) as { clientAccountId: string; tv?: number };
      const account = await storage.getClientAccount(payload.clientAccountId);
      if (account && account.status === "ativo" && (payload.tv ?? 0) === (account.tokenVersion ?? 0)) {
        req.clientAccountId = payload.clientAccountId;
        return next();
      }
    } catch { /* fall through to 401 */ }
  }

  return res.status(401).json({ message: "Não autenticado" });
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Strip camera credentials from list responses (admin detail endpoint keeps them for editing)
  function stripCameraCredentials(camera: any) {
    const { usuario, senha, hostname, portaHttp, ...safe } = camera;
    return safe;
  }

  // Sanitize filename for Content-Disposition header
  function sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
  }

  // Validate file path is within uploads directory (prevents path traversal)
  const UPLOADS_DIR = path.resolve("uploads");
  function isPathSafe(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    return resolved.startsWith(UPLOADS_DIR);
  }

  // Validate date string format (YYYY-MM-DD)
  function isValidDate(str: string): boolean {
    const d = new Date(str);
    return !isNaN(d.getTime());
  }

  // Serve captured images from R2 (auth required)
  app.get("/api/captures/:cameraId/:date/:filename", isAnyAuthenticated, async (req, res) => {
    try {
      const { getStreamFromR2 } = await import("./r2");
      const r2Key = `captures/${req.params.cameraId}/${req.params.date}/${req.params.filename}`;
      const { stream, contentType } = await getStreamFromR2(r2Key);
      res.set("Content-Type", contentType || "image/jpeg");
      res.set("Cache-Control", "public, max-age=3600");
      stream.pipe(res);
    } catch {
      res.status(404).json({ message: "Arquivo não encontrado" });
    }
  });

  // Serve videos from R2 (auth required)
  app.get("/api/videos/:filename", isAnyAuthenticated, async (req, res) => {
    try {
      const { getStreamFromR2 } = await import("./r2");
      const r2Key = `videos/${req.params.filename}`;
      const { stream, contentType } = await getStreamFromR2(r2Key);
      res.set("Content-Type", contentType || "video/mp4");
      res.set("Cache-Control", "public, max-age=3600");
      stream.pipe(res);
    } catch {
      res.status(404).json({ message: "Arquivo não encontrado" });
    }
  });

  // Dashboard extended — activity chart + storage size
  app.get("/api/admin/dashboard-extra", isAdminAuthenticated, async (req, res) => {
    try {
      const extra = await storage.getDashboardExtra();

      // Calculate storage from database (sum of capture + timelapse sizes)
      let storageBytes = 0;
      try {
        const [captureSize] = await db.select({ total: sql<number>`coalesce(sum(tamanho_bytes), 0)` }).from(captures);
        const [videoSize] = await db.select({ total: sql<number>`coalesce(sum(tamanho_bytes), 0)` }).from(timelapses);
        storageBytes = Number(captureSize?.total || 0) + Number(videoSize?.total || 0);
      } catch { /* ignore */ }

      res.json({ ...extra, storageBytes });
    } catch (error) {
      console.error("dashboard-extra error:", error);
      res.status(500).json({ message: "Failed" });
    }
  });

  // System info — portal URL + cameras with stream URLs
  app.get("/api/admin/system-info", isAdminAuthenticated, async (req, res) => {
    try {
      const allCameras = await storage.getCameras();
      res.json({
        portalUrl: process.env.PORTAL_URL || null,
        cameras: allCameras.map((c) => ({
          id: c.id,
          nome: c.nome,
          status: c.status,
          streamUrl: c.streamUrl || null,
          hostname: c.hostname || null,
          ultimaCaptura: c.ultimaCaptura || null,
        })),
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch system info" });
    }
  });

  // Admin Stats
  app.get("/api/admin/stats", isAdminAuthenticated, async (req, res) => {
    try {
      const stats = await storage.getStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Clients CRUD
  app.get("/api/admin/clients", isAdminAuthenticated, async (req, res) => {
    try {
      const clients = await storage.getClients();
      res.json(clients);
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  app.get("/api/admin/clients/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      res.json(client);
    } catch (error) {
      console.error("Error fetching client:", error);
      res.status(500).json({ message: "Failed to fetch client" });
    }
  });

  app.post("/api/admin/clients", isAdminAuthenticated, async (req, res) => {
    try {
      const data = insertClientSchema.parse(req.body);
      const client = await storage.createClient(data);
      res.status(201).json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error creating client:", error);
      res.status(500).json({ message: "Failed to create client" });
    }
  });

  app.put("/api/admin/clients/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const data = insertClientSchema.partial().parse(req.body);
      const client = await storage.updateClient(req.params.id, data);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      res.json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error updating client:", error);
      res.status(500).json({ message: "Failed to update client" });
    }
  });

  app.delete("/api/admin/clients/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const deleted = await storage.deleteClient(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Client not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting client:", error);
      res.status(500).json({ message: "Failed to delete client" });
    }
  });

  // Locations CRUD
  app.get("/api/admin/locations", isAdminAuthenticated, async (req, res) => {
    try {
      const locations = await storage.getLocations();
      res.json(locations);
    } catch (error) {
      console.error("Error fetching locations:", error);
      res.status(500).json({ message: "Failed to fetch locations" });
    }
  });

  app.get("/api/admin/locations/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const location = await storage.getLocation(req.params.id);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      res.json(location);
    } catch (error) {
      console.error("Error fetching location:", error);
      res.status(500).json({ message: "Failed to fetch location" });
    }
  });

  app.post("/api/admin/locations", isAdminAuthenticated, async (req, res) => {
    try {
      const data = insertLocationSchema.parse(req.body);
      const location = await storage.createLocation(data);
      res.status(201).json(location);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error creating location:", error);
      res.status(500).json({ message: "Failed to create location" });
    }
  });

  app.put("/api/admin/locations/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const data = insertLocationSchema.partial().parse(req.body);
      const location = await storage.updateLocation(req.params.id, data);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
      res.json(location);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error updating location:", error);
      res.status(500).json({ message: "Failed to update location" });
    }
  });

  app.delete("/api/admin/locations/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const deleted = await storage.deleteLocation(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Location not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting location:", error);
      res.status(500).json({ message: "Failed to delete location" });
    }
  });

  // Cameras CRUD
  app.get("/api/admin/cameras", isAdminAuthenticated, async (req, res) => {
    try {
      const cameras = await storage.getCameras();
      res.json(cameras.map(stripCameraCredentials));
    } catch (error) {
      console.error("Error fetching cameras:", error);
      res.status(500).json({ message: "Failed to fetch cameras" });
    }
  });

  app.get("/api/admin/cameras/offline", isAdminAuthenticated, async (req, res) => {
    try {
      const cameras = await storage.getOfflineCameras();
      res.json(cameras.map(stripCameraCredentials));
    } catch (error) {
      console.error("Error fetching offline cameras:", error);
      res.status(500).json({ message: "Failed to fetch offline cameras" });
    }
  });

  app.get("/api/admin/cameras/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const camera = await storage.getCamera(req.params.id);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }
      res.json(camera);
    } catch (error) {
      console.error("Error fetching camera:", error);
      res.status(500).json({ message: "Failed to fetch camera" });
    }
  });

  app.get("/api/admin/cameras/:id/last-capture", isAdminAuthenticated, async (req, res) => {
    try {
      const capture = await storage.getLastCapture(req.params.id);
      if (!capture) {
        return res.status(404).json({ message: "No capture found" });
      }
      res.json(capture);
    } catch (error) {
      console.error("Error fetching last capture:", error);
      res.status(500).json({ message: "Failed to fetch last capture" });
    }
  });

  app.get("/api/admin/cameras/:id/captures", isAdminAuthenticated, async (req, res) => {
    try {
      const { dataInicio, dataFim, page, limit } = req.query;
      if ((dataInicio && !isValidDate(dataInicio as string)) || (dataFim && !isValidDate(dataFim as string))) {
        return res.status(400).json({ message: "Formato de data inválido" });
      }
      const result = await storage.getCaptures(
        req.params.id,
        dataInicio as string | undefined,
        dataFim as string | undefined,
        page ? Math.max(1, parseInt(page as string, 10) || 1) : 1,
        limit ? Math.min(500, Math.max(1, parseInt(limit as string, 10) || 50)) : 50,
      );
      res.json(result);
    } catch (error) {
      console.error("Error fetching captures:", error);
      res.status(500).json({ message: "Failed to fetch captures" });
    }
  });

  app.get("/api/admin/cameras/:id/captures/download", isAdminAuthenticated, async (req, res) => {
    try {
      const { dataInicio, dataFim } = req.query;
      if (!dataInicio || !dataFim) {
        return res.status(400).json({ message: "Informe dataInicio e dataFim" });
      }
      const captures = await storage.getAllCaptures(
        req.params.id,
        dataInicio as string,
        dataFim as string
      );
      if (!captures || captures.length === 0) {
        return res.status(404).json({ message: "Nenhuma captura encontrada no período" });
      }
      if (captures.length > 3000) {
        return res.status(400).json({ message: `Período contém ${captures.length} capturas. Máximo por download: 3000. Reduza o intervalo de datas.` });
      }
      const camera = await storage.getCamera(req.params.id);
      const nomeCamera = camera?.nome || "camera";
      const filename = sanitizeFilename(`${nomeCamera}_${dataInicio}_${dataFim}`) + ".zip";

      res.set("Content-Type", "application/zip");
      res.set("Content-Disposition", `attachment; filename="${filename}"`);

      const archive = archiver("zip", { zlib: { level: 1 } });
      archive.pipe(res);

      const { getFromR2 } = await import("./r2");
      for (const capture of captures) {
        if (capture.imagemPath) {
          try {
            const buffer = await getFromR2(capture.imagemPath);
            const fileName = capture.capturadoEm
              ? `${new Date(capture.capturadoEm).toISOString().replace(/[T:]/g, "-").slice(0, 19)}.jpg`
              : capture.imagemPath.split("/").pop() || "capture.jpg";
            archive.append(buffer, { name: fileName });
          } catch { /* skip missing files */ }
        }
      }

      await archive.finalize();
    } catch (error) {
      console.error("Error downloading admin captures ZIP:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Erro ao gerar ZIP" });
      }
    }
  });

  app.delete("/api/admin/captures/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const capture = await storage.deleteCapture(req.params.id);
      if (!capture) {
        return res.status(404).json({ message: "Captura não encontrada" });
      }
      // Deletar arquivo do R2
      if (capture.imagemPath) {
        try {
          const { deleteFromR2 } = await import("./r2");
          await deleteFromR2(capture.imagemPath);
        } catch { /* ignore — file may not exist */ }
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting capture:", error);
      res.status(500).json({ message: "Erro ao deletar captura" });
    }
  });

  app.post("/api/admin/cameras", isAdminAuthenticated, async (req, res) => {
    try {
      const data = insertCameraSchema.parse(req.body);

      if (data.hostname && !isSafeTarget(data.hostname)) {
        return res.status(400).json({ message: "Hostname não permitido" });
      }
      if (data.streamUrl && !isSafeTarget(data.streamUrl)) {
        return res.status(400).json({ message: "URL de stream não permitida" });
      }

      const camera = await storage.createCamera(data);
      audit("camera.created", { adminId: req.adminAccountId, cameraId: camera.id, nome: camera.nome });
      res.status(201).json(stripCameraCredentials(camera));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error creating camera:", error);
      res.status(500).json({ message: "Failed to create camera" });
    }
  });

  app.post("/api/admin/cameras/test", isAdminAuthenticated, async (req, res) => {
    try {
      const { hostname, portaHttp, usuario, senha, marca, streamUrl } = req.body;

      // go2rtc mode: test via /api/streams
      if (streamUrl) {
        if (!isSafeTarget(streamUrl)) {
          return res.json({ sucesso: false, mensagem: "URL de stream não permitida" });
        }
        const result = await testGo2rtcConnection(streamUrl);
        return res.json(result);
      }

      if (!hostname || !portaHttp || !usuario || !senha) {
        return res.json({ sucesso: false, mensagem: "Dados de conexão incompletos" });
      }

      if (!isSafeTarget(hostname)) {
        return res.json({ sucesso: false, mensagem: "Hostname não permitido" });
      }

      const result = await testCameraConnection({
        hostname,
        portaHttp: Number(portaHttp),
        usuario,
        senha,
        marca: marca || "reolink",
      });

      if (result.sucesso && result.imageBuffer) {
        const base64Image = result.imageBuffer.toString("base64");
        return res.json({
          sucesso: true,
          mensagem: "Conexão bem-sucedida! Câmera respondeu corretamente.",
          imagem: `data:${result.contentType};base64,${base64Image}`,
        });
      }

      res.json({ sucesso: result.sucesso, mensagem: result.mensagem });
    } catch (error) {
      console.error("Error testing camera:", error);
      res.json({ sucesso: false, mensagem: "Erro ao testar conexão" });
    }
  });

  // Fast thumbnail from last saved capture (serves resized JPEG from R2)
  app.get("/api/admin/cameras/:id/thumbnail", isAdminAuthenticated, async (req, res) => {
    try {
      const capture = await storage.getLastCapture(req.params.id);
      if (!capture) {
        return res.status(404).json({ message: "Nenhuma captura encontrada" });
      }
      const { THUMB_WIDTH, THUMB_QUALITY } = await import("./thumbnail");
      const etag = `"thumb-${capture.id}-w${THUMB_WIDTH}q${THUMB_QUALITY}"`;
      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "private, max-age=300");
      res.set("ETag", etag);
      if (req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }
      try {
        const { getResizedThumbnail } = await import("./thumbnail");
        const buf = await getResizedThumbnail({ captureId: capture.id, r2Key: capture.imagemPath });
        res.send(buf);
      } catch (resizeErr) {
        // Fallback: stream original if resize fails (corrupt image, etc)
        console.error("[thumbnail] resize failed, falling back to original:", resizeErr);
        const { getStreamFromR2 } = await import("./r2");
        const { stream } = await getStreamFromR2(capture.imagemPath);
        stream.pipe(res);
      }
    } catch (error) {
      console.error("Error serving thumbnail:", error);
      res.status(500).json({ message: "Erro ao servir thumbnail" });
    }
  });

  // Live snapshot (fetches from camera in real-time — slower)
  app.get("/api/admin/cameras/:id/snapshot", isAdminAuthenticated, async (req, res) => {
    try {
      const camera = await storage.getCamera(req.params.id);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }

      if (camera.streamUrl && !isSafeTarget(camera.streamUrl)) {
        return res.status(400).json({ message: "URL de stream não permitida" });
      }
      if (camera.hostname && !isSafeTarget(camera.hostname)) {
        return res.status(400).json({ message: "Hostname não permitido" });
      }

      const result = await fetchSnapshot({
        streamUrl: camera.streamUrl,
        hostname: camera.hostname,
        portaHttp: camera.portaHttp,
        usuario: camera.usuario,
        senha: camera.senha,
        marca: camera.marca || "reolink",
      });

      if (result.sucesso && result.imageBuffer) {
        res.set("Content-Type", result.contentType || "image/jpeg");
        res.set("Cache-Control", "no-cache, no-store, must-revalidate");
        res.send(result.imageBuffer);
      } else {
        res.status(503).json({ 
          message: result.mensagem || "Não foi possível obter snapshot da câmera" 
        });
      }
    } catch (error) {
      console.error("Error fetching snapshot:", error);
      res.status(500).json({ message: "Erro ao buscar snapshot" });
    }
  });

  app.put("/api/admin/cameras/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const data = insertCameraSchema.partial().parse(req.body);

      if (data.hostname && !isSafeTarget(data.hostname)) {
        return res.status(400).json({ message: "Hostname não permitido" });
      }
      if (data.streamUrl && !isSafeTarget(data.streamUrl)) {
        return res.status(400).json({ message: "URL de stream não permitida" });
      }

      const camera = await storage.updateCamera(req.params.id, data);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }
      res.json(stripCameraCredentials(camera));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error updating camera:", error);
      res.status(500).json({ message: "Failed to update camera" });
    }
  });

  app.delete("/api/admin/cameras/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const deleted = await storage.deleteCamera(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Camera not found" });
      }
      audit("camera.deleted", { adminId: req.adminAccountId, cameraId: req.params.id });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting camera:", error);
      res.status(500).json({ message: "Failed to delete camera" });
    }
  });

  // Timelapses CRUD
  app.get("/api/admin/timelapses", isAdminAuthenticated, async (req, res) => {
    try {
      const timelapses = await storage.getTimelapses();
      res.json(timelapses);
    } catch (error) {
      console.error("Error fetching timelapses:", error);
      res.status(500).json({ message: "Failed to fetch timelapses" });
    }
  });

  app.get("/api/admin/timelapses/recent", isAdminAuthenticated, async (req, res) => {
    try {
      const timelapses = await storage.getRecentTimelapses(5);
      res.json(timelapses);
    } catch (error) {
      console.error("Error fetching recent timelapses:", error);
      res.status(500).json({ message: "Failed to fetch recent timelapses" });
    }
  });

  app.get("/api/admin/timelapses/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const timelapse = await storage.getTimelapse(req.params.id);
      if (!timelapse) {
        return res.status(404).json({ message: "Timelapse not found" });
      }
      res.json(timelapse);
    } catch (error) {
      console.error("Error fetching timelapse:", error);
      res.status(500).json({ message: "Failed to fetch timelapse" });
    }
  });

  app.post("/api/admin/timelapses", isAdminAuthenticated, async (req, res) => {
    try {
      const data = insertTimelapseSchema.parse({
        ...req.body,
        solicitadoPor: req.adminAccountId,
        status: "na_fila",
      });
      const timelapse = await storage.createTimelapse(data);
      res.status(201).json(timelapse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error creating timelapse:", error);
      res.status(500).json({ message: "Failed to create timelapse" });
    }
  });

  app.delete("/api/admin/timelapses/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const timelapse = await storage.deleteTimelapse(req.params.id);
      if (!timelapse) {
        return res.status(404).json({ message: "Timelapse not found" });
      }
      // Deletar arquivo de vídeo do R2
      if (timelapse.videoPath) {
        try {
          const { deleteFromR2 } = await import("./r2");
          await deleteFromR2(timelapse.videoPath);
        } catch { /* ignore */ }
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting timelapse:", error);
      res.status(500).json({ message: "Failed to delete timelapse" });
    }
  });

  // Builds a safe admin DTO for a client account: never includes senhaHash or camera credentials
  function toSafeAccountDTO(account: Awaited<ReturnType<typeof storage.getClientAccount>>) {
    if (!account) return null;
    return {
      id: account.id,
      nome: account.nome,
      email: account.email,
      clienteId: account.clienteId,
      status: account.status,
      createdAt: account.createdAt,
      cliente: account.cliente
        ? { id: account.cliente.id, nome: account.cliente.nome }
        : null,
      // Only expose camera IDs — never include host/usuario/senha/port
      cameraIds: (account.cameraAccess ?? []).map((a) => a.cameraId),
      camerasCount: (account.cameraAccess ?? []).length,
    };
  }

  // Client Accounts (admin management)
  app.get("/api/admin/client-accounts", isAdminAuthenticated, async (req, res) => {
    try {
      const accounts = await storage.getClientAccounts();
      res.json(accounts.map((a) => toSafeAccountDTO(a)));
    } catch (error) {
      console.error("Error fetching client accounts:", error);
      res.status(500).json({ message: "Failed to fetch client accounts" });
    }
  });

  app.get("/api/admin/client-accounts/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const account = await storage.getClientAccount(req.params.id);
      if (!account) return res.status(404).json({ message: "Account not found" });
      res.json(toSafeAccountDTO(account));
    } catch (error) {
      console.error("Error fetching client account:", error);
      res.status(500).json({ message: "Failed to fetch client account" });
    }
  });

  app.post("/api/admin/client-accounts", isAdminAuthenticated, async (req, res) => {
    try {
      const data = insertClientAccountSchema.parse(req.body);
      const senhaTrim = data.senha.trim();
      const existing = await storage.getClientAccountByEmail(data.email);
      if (existing) {
        return res.status(409).json({ message: "Já existe uma conta com este e-mail" });
      }
      const senhaHash = await bcrypt.hash(senhaTrim, 12);
      const account = await storage.createClientAccount({
        clienteId: data.clienteId || null,
        nome: data.nome,
        email: data.email,
        senhaHash,
        status: data.status || "ativo",
      });
      if (data.cameraIds && data.cameraIds.length > 0) {
        await storage.setClientCameraAccess(account.id, data.cameraIds);
      }
      const full = await storage.getClientAccount(account.id);

      // Send welcome email with credentials (non-blocking)
      const clienteNome = full?.cliente?.nome;
      sendWelcomeEmail({
        nome: data.nome,
        email: data.email,
        senha: senhaTrim,
        clienteNome: clienteNome || undefined,
      }).catch((err) => console.error("[email] Falha ao enviar:", err));

      audit("client.account.created", { adminId: req.adminAccountId, newAccountId: account.id, email: data.email });
      res.status(201).json(toSafeAccountDTO(full));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error creating client account:", error);
      res.status(500).json({ message: "Failed to create client account" });
    }
  });

  app.put("/api/admin/client-accounts/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const updateSchema = insertClientAccountSchema.partial().extend({
        senha: z.string().min(8, "Senha deve ter pelo menos 8 caracteres").optional(),
        cameraIds: z.array(z.string()).optional(),
      });
      const parsed = updateSchema.parse(req.body);
      const { senha, cameraIds, ...rest } = parsed;

      // Check email uniqueness on update
      if (rest.email) {
        const existing = await storage.getClientAccountByEmail(rest.email);
        if (existing && existing.id !== req.params.id) {
          return res.status(409).json({ message: "Já existe uma conta com este e-mail" });
        }
      }

      type ClientAccountUpdate = Parameters<typeof storage.updateClientAccount>[1];
      const updateData: ClientAccountUpdate = { ...rest };
      if (senha && senha.length >= 8) {
        updateData.senhaHash = await bcrypt.hash(senha, 12);
      }
      const account = await storage.updateClientAccount(req.params.id, updateData);
      if (!account) return res.status(404).json({ message: "Account not found" });
      if (Array.isArray(cameraIds)) {
        await storage.setClientCameraAccess(account.id, cameraIds);
      }
      const full = await storage.getClientAccount(account.id);
      res.json(toSafeAccountDTO(full));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error updating client account:", error);
      res.status(500).json({ message: "Failed to update client account" });
    }
  });

  app.delete("/api/admin/client-accounts/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const deleted = await storage.deleteClientAccount(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Account not found" });
      audit("client.account.deleted", { adminId: req.adminAccountId, deletedAccountId: req.params.id });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting client account:", error);
      res.status(500).json({ message: "Failed to delete client account" });
    }
  });

  // Client login (JWT-based, separate from admin Replit Auth session)
  app.post("/api/client/login", async (req, res) => {
    try {
      const ip = getClientIp(req);
      const loginSchema = z.object({
        email: z.string().email("E-mail inválido"),
        senha: z.string().min(1, "Senha é obrigatória"),
      });
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Dados inválidos" });
      }
      const { email } = parsed.data;
      const senha = parsed.data.senha.trim();
      if (!checkRateLimit(ip, email)) {
        return res.status(429).json({ message: "Muitas tentativas de login. Aguarde 15 minutos." });
      }
      const account = await storage.getClientAccountByEmail(email);
      if (!account) {
        recordFailedLogin(ip, email);
        audit("client.login.failure", { email, ip, reason: "account_not_found" });
        return res.status(401).json({ message: "E-mail ou senha incorretos" });
      }
      if (account.status !== "ativo") {
        recordFailedLogin(ip, email);
        audit("client.login.failure", { email, ip, reason: "account_inactive" });
        return res.status(401).json({ message: "E-mail ou senha incorretos" });
      }
      const valid = await bcrypt.compare(senha, account.senhaHash);
      if (!valid) {
        recordFailedLogin(ip, email);
        audit("client.login.failure", { email, ip, reason: "wrong_password" });
        return res.status(401).json({ message: "E-mail ou senha incorretos" });
      }
      resetRateLimit(ip, email);
      audit("client.login.success", { accountId: account.id, email, ip });
      const cameraIds = await storage.getClientCameraIds(account.id);
      const token = jwt.sign(
        { clientAccountId: account.id, tv: account.tokenVersion ?? 0 },
        CLIENT_JWT_SECRET,
        { expiresIn: "24h" }
      );
      res.cookie("skylapse-client-token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: "strict",
      });
      res.json({ 
        id: account.id, 
        nome: account.nome, 
        email: account.email,
        clienteId: account.clienteId,
        cameraIds,
      });
    } catch (error) {
      console.error("Error client login:", error);
      res.status(500).json({ message: "Erro ao fazer login" });
    }
  });

  // ── Admin Auth ────────────────────────────────────────────────────────────
  app.post("/api/admin/login", async (req, res) => {
    try {
      const ip = getClientIp(req);
      const loginSchema = z.object({
        email: z.string().email("E-mail inválido"),
        senha: z.string().min(1, "Senha obrigatória"),
      });
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Dados inválidos" });
      }
      const { email } = parsed.data;
      const senha = parsed.data.senha.trim();
      if (!checkRateLimit(ip, email)) {
        return res.status(429).json({ message: "Muitas tentativas de login. Aguarde 15 minutos." });
      }
      const account = await storage.getAdminAccountByEmail(email);
      if (!account) {
        recordFailedLogin(ip, email);
        audit("admin.login.failure", { email, ip, reason: "account_not_found" });
        return res.status(401).json({ message: "E-mail ou senha incorretos" });
      }
      const valid = await bcrypt.compare(senha, account.senhaHash);
      if (!valid) {
        recordFailedLogin(ip, email);
        audit("admin.login.failure", { email, ip, reason: "wrong_password" });
        return res.status(401).json({ message: "E-mail ou senha incorretos" });
      }
      resetRateLimit(ip, email);
      audit("admin.login.success", { accountId: account.id, email, ip });
      const token = jwt.sign(
        { adminAccountId: account.id, tv: account.tokenVersion ?? 0 },
        ADMIN_JWT_SECRET,
        { expiresIn: "24h" }
      );
      res.cookie("skylapse-admin-token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: "strict",
      });
      res.json({ id: account.id, nome: account.nome, email: account.email });
    } catch (error) {
      console.error("Error admin login:", error);
      res.status(500).json({ message: "Erro ao fazer login" });
    }
  });

  app.post("/api/admin/logout", isAdminAuthenticated, async (req, res) => {
    await storage.incrementAdminTokenVersion(req.adminAccountId!);
    audit("admin.logout", { adminAccountId: req.adminAccountId });
    res.clearCookie("skylapse-admin-token");
    res.json({ message: "Logout realizado" });
  });

  app.get("/api/admin/me", isAdminAuthenticated, async (req, res) => {
    try {
      const account = await storage.getAdminAccount(req.adminAccountId!);
      if (!account) {
        res.clearCookie("skylapse-admin-token");
        return res.status(401).json({ message: "Conta não encontrada" });
      }
      res.json({ id: account.id, nome: account.nome, email: account.email });
    } catch (error) {
      console.error("Error admin me:", error);
      res.status(500).json({ message: "Erro ao buscar dados" });
    }
  });

  // ── Admin Account Management (admins managing admin accounts) ─────────────
  app.get("/api/admin/accounts", isAdminAuthenticated, async (req, res) => {
    try {
      const accounts = await storage.getAdminAccounts();
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching admin accounts:", error);
      res.status(500).json({ message: "Erro ao buscar contas" });
    }
  });

  app.post("/api/admin/accounts", isAdminAuthenticated, async (req, res) => {
    try {
      const data = insertAdminAccountSchema.parse(req.body);
      const senhaTrim = data.senha.trim();
      const senhaHash = await bcrypt.hash(senhaTrim, 12);
      const account = await storage.createAdminAccount({
        nome: data.nome,
        email: data.email,
        senhaHash,
      });
      sendAdminWelcomeEmail({
        nome: data.nome,
        email: data.email,
        senha: senhaTrim,
      }).catch(console.error);
      audit("admin.account.created", { creatorId: req.adminAccountId, newAccountId: account.id, email: data.email });
      res.status(201).json({ id: account.id, nome: account.nome, email: account.email, createdAt: account.createdAt });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos" });
      }
      console.error("Error creating admin account:", error);
      res.status(500).json({ message: "Erro ao criar conta" });
    }
  });

  app.put("/api/admin/accounts/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const updateSchema = z.object({
        nome: z.string().min(1).optional(),
        email: z.string().email().optional(),
        senha: z.string().min(8, "Senha deve ter pelo menos 8 caracteres").optional(),
      });
      const data = updateSchema.parse(req.body);
      const updateData: Partial<{ nome: string; email: string; senhaHash: string }> = {};
      if (data.nome) updateData.nome = data.nome;
      if (data.email) updateData.email = data.email;
      if (data.senha) updateData.senhaHash = await bcrypt.hash(data.senha, 12);
      const updated = await storage.updateAdminAccount(req.params.id, updateData);
      if (!updated) {
        return res.status(404).json({ message: "Conta não encontrada" });
      }
      res.json({ id: updated.id, nome: updated.nome, email: updated.email, createdAt: updated.createdAt });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos" });
      }
      console.error("Error updating admin account:", error);
      res.status(500).json({ message: "Erro ao atualizar conta" });
    }
  });

  app.delete("/api/admin/accounts/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const count = await storage.countAdminAccounts();
      if (count <= 1) {
        return res.status(400).json({ message: "Não é possível excluir a única conta administradora" });
      }
      const deleted = await storage.deleteAdminAccount(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Conta não encontrada" });
      }
      res.json({ message: "Conta excluída" });
    } catch (error) {
      console.error("Error deleting admin account:", error);
      res.status(500).json({ message: "Erro ao excluir conta" });
    }
  });

  // ── Client Camera Endpoints ───────────────────────────────────────────────
  // Safe DTO: never expose hostname, usuario, senha, or any credential to the client
  function toClientCameraDTO(camera: Awaited<ReturnType<typeof storage.getCamera>>, localidade?: { nome: string; cidade?: string | null; estado?: string | null } | null) {
    if (!camera) return null;
    return {
      id: camera.id,
      nome: camera.nome,
      marca: camera.marca,
      modelo: camera.modelo,
      status: camera.status,
      ultimaCaptura: camera.ultimaCaptura,
      intervaloCaptura: camera.intervaloCaptura,
      streamUrl: camera.streamUrl ?? null,
      localidade: localidade ? { nome: localidade.nome, cidade: localidade.cidade, estado: localidade.estado } : null,
    };
  }

  app.get("/api/client/cameras", isClientAuthenticated, async (req, res) => {
    try {
      const cameraIds = await storage.getClientCameraIds(req.clientAccountId!);
      if (cameraIds.length === 0) return res.json([]);
      const allCameras = await storage.getCameras();
      const clientCameras = allCameras
        .filter((c) => cameraIds.includes(c.id))
        .map((c) => toClientCameraDTO(c, c.localidade));
      res.json(clientCameras);
    } catch (error) {
      console.error("Error fetching client cameras:", error);
      res.status(500).json({ message: "Erro ao buscar câmeras" });
    }
  });

  app.get("/api/client/cameras/:id/captures", isClientAuthenticated, async (req, res) => {
    try {
      const allowedIds = await storage.getClientCameraIds(req.clientAccountId!);
      if (!allowedIds.includes(req.params.id)) {
        return res.status(403).json({ message: "Acesso negado a esta câmera" });
      }
      const { dataInicio, dataFim, page, limit } = req.query;
      const result = await storage.getCaptures(
        req.params.id,
        dataInicio as string | undefined,
        dataFim as string | undefined,
        page ? Math.max(1, parseInt(page as string, 10) || 1) : 1,
        limit ? Math.min(500, Math.max(1, parseInt(limit as string, 10) || 50)) : 50,
      );
      res.json(result);
    } catch (error) {
      console.error("Error fetching client captures:", error);
      res.status(500).json({ message: "Erro ao buscar capturas" });
    }
  });

  app.get("/api/client/cameras/:id/captures/download", isClientAuthenticated, async (req, res) => {
    try {
      const allowedIds = await storage.getClientCameraIds(req.clientAccountId!);
      if (!allowedIds.includes(req.params.id)) {
        return res.status(403).json({ message: "Acesso negado a esta câmera" });
      }
      const { dataInicio, dataFim } = req.query;
      if (!dataInicio || !dataFim) {
        return res.status(400).json({ message: "Informe dataInicio e dataFim" });
      }
      const captures = await storage.getAllCaptures(
        req.params.id,
        dataInicio as string,
        dataFim as string
      );
      if (!captures || captures.length === 0) {
        return res.status(404).json({ message: "Nenhuma captura encontrada no período" });
      }
      if (captures.length > 3000) {
        return res.status(400).json({ message: `Período contém ${captures.length} capturas. Máximo por download: 3000. Reduza o intervalo de datas.` });
      }

      const camera = await storage.getCamera(req.params.id);
      const nomeCamera = camera?.nome || "camera";
      const filename = sanitizeFilename(`${nomeCamera}_${dataInicio}_${dataFim}`) + ".zip";

      res.set("Content-Type", "application/zip");
      res.set("Content-Disposition", `attachment; filename="${filename}"`);

      const archive = archiver("zip", { zlib: { level: 1 } });
      archive.pipe(res);

      const { getFromR2: getFromR2Client } = await import("./r2");
      for (const capture of captures) {
        if (capture.imagemPath) {
          try {
            const buffer = await getFromR2Client(capture.imagemPath);
            const fileName = capture.capturadoEm
              ? `${new Date(capture.capturadoEm).toISOString().replace(/[T:]/g, "-").slice(0, 19)}.jpg`
              : capture.imagemPath.split("/").pop() || "capture.jpg";
            archive.append(buffer, { name: fileName });
          } catch { /* skip missing files */ }
        }
      }

      await archive.finalize();
    } catch (error) {
      console.error("Error downloading captures ZIP:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Erro ao gerar ZIP" });
      }
    }
  });

  app.get("/api/client/cameras/:id/thumbnail", isClientAuthenticated, async (req, res) => {
    try {
      const allowedIds = await storage.getClientCameraIds(req.clientAccountId!);
      if (!allowedIds.includes(req.params.id)) {
        return res.status(403).json({ message: "Acesso negado a esta câmera" });
      }
      const capture = await storage.getLastCapture(req.params.id);
      if (!capture) {
        return res.status(404).json({ message: "Nenhuma captura encontrada" });
      }
      const { THUMB_WIDTH, THUMB_QUALITY } = await import("./thumbnail");
      const etag = `"thumb-${capture.id}-w${THUMB_WIDTH}q${THUMB_QUALITY}"`;
      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "private, max-age=300");
      res.set("ETag", etag);
      if (req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }
      try {
        const { getResizedThumbnail } = await import("./thumbnail");
        const buf = await getResizedThumbnail({ captureId: capture.id, r2Key: capture.imagemPath });
        res.send(buf);
      } catch (resizeErr) {
        console.error("[thumbnail] resize failed, falling back to original:", resizeErr);
        const { getStreamFromR2 } = await import("./r2");
        const { stream } = await getStreamFromR2(capture.imagemPath);
        stream.pipe(res);
      }
    } catch (error) {
      console.error("Error serving client thumbnail:", error);
      res.status(500).json({ message: "Erro ao servir thumbnail" });
    }
  });

  app.get("/api/client/cameras/:id/snapshot", isClientAuthenticated, async (req, res) => {
    try {
      const allowedIds = await storage.getClientCameraIds(req.clientAccountId!);
      if (!allowedIds.includes(req.params.id)) {
        return res.status(403).json({ message: "Acesso negado a esta câmera" });
      }
      const camera = await storage.getCamera(req.params.id);
      if (!camera) return res.status(404).json({ message: "Câmera não encontrada" });

      if (camera.streamUrl && !isSafeTarget(camera.streamUrl)) {
        return res.status(400).json({ message: "URL de stream não permitida" });
      }
      if (camera.hostname && !isSafeTarget(camera.hostname)) {
        return res.status(400).json({ message: "Hostname não permitido" });
      }

      const result = await fetchSnapshot({
        streamUrl: camera.streamUrl,
        hostname: camera.hostname,
        portaHttp: camera.portaHttp,
        usuario: camera.usuario,
        senha: camera.senha,
        marca: camera.marca || "reolink",
      });
      if (result.sucesso && result.imageBuffer) {
        res.set("Content-Type", result.contentType || "image/jpeg");
        res.set("Cache-Control", "no-cache, no-store, must-revalidate");
        res.send(result.imageBuffer);
      } else {
        res.status(503).json({ message: result.mensagem || "Câmera indisponível" });
      }
    } catch (error) {
      console.error("Error fetching client snapshot:", error);
      res.status(500).json({ message: "Erro ao buscar imagem" });
    }
  });

  app.post("/api/client/logout", isClientAuthenticated, async (req, res) => {
    await storage.incrementClientTokenVersion(req.clientAccountId!);
    audit("client.logout", { clientAccountId: req.clientAccountId });
    res.clearCookie("skylapse-client-token");
    res.json({ message: "Logout realizado" });
  });

  app.get("/api/client/me", isClientAuthenticated, async (req, res) => {
    try {
      const clientAccountId = req.clientAccountId!;
      const account = await storage.getClientAccount(clientAccountId);
      if (!account) {
        res.clearCookie("skylapse-client-token");
        return res.status(401).json({ message: "Conta não encontrada" });
      }
      const cameraIds = await storage.getClientCameraIds(account.id);
      // Return a strict DTO — never spread account to avoid leaking camera credentials
      res.json({
        id: account.id,
        nome: account.nome,
        email: account.email,
        clienteId: account.clienteId,
        status: account.status,
        createdAt: account.createdAt,
        senhaAlterada: account.senhaAlterada,
        cameraIds,
      });
    } catch (error) {
      console.error("Error fetching client me:", error);
      res.status(500).json({ message: "Erro ao buscar dados" });
    }
  });

  // Change password (authenticated client)
  app.post("/api/client/change-password", isClientAuthenticated, async (req, res) => {
    try {
      if (!checkChangePasswordRateLimit(req.clientAccountId!)) {
        return res.status(429).json({ message: "Muitas tentativas. Aguarde 15 minutos." });
      }

      const schema = z.object({
        senhaAtual: z.string().min(1),
        novaSenha: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Dados inválidos" });
      }
      const account = await storage.getClientAccountByEmail(
        (await storage.getClientAccount(req.clientAccountId!))!.email
      );
      if (!account) return res.status(404).json({ message: "Conta não encontrada" });

      const valid = await bcrypt.compare(parsed.data.senhaAtual, account.senhaHash);
      if (!valid) return res.status(401).json({ message: "Senha atual incorreta" });

      const senhaHash = await bcrypt.hash(parsed.data.novaSenha, 12);
      await storage.updateClientPassword(account.id, senhaHash);
      await storage.incrementClientTokenVersion(account.id);
      audit("client.password.changed", { accountId: account.id, ip: getClientIp(req)});
      res.clearCookie("skylapse-client-token");
      res.json({ message: "Senha alterada com sucesso" });
    } catch (error) {
      console.error("Error changing password:", error);
      res.status(500).json({ message: "Erro ao alterar senha" });
    }
  });

  // Request password reset (public)
  app.post("/api/client/forgot-password", async (req, res) => {
    try {
      const ip = getClientIp(req);
      if (!checkResetRateLimit(ip)) {
        return res.status(429).json({ message: "Muitas tentativas. Aguarde 15 minutos." });
      }
      const { email } = z.object({ email: z.string().email() }).parse(req.body);
      const account = await storage.getClientAccountByEmail(email);
      // Always return success to avoid email enumeration
      if (!account) return res.json({ message: "Se o e-mail existir, você receberá as instruções." });

      const token = crypto.randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await storage.setResetToken(account.id, token, expiry);

      const resetUrl = `${process.env.PORTAL_URL || "http://localhost:3000"}/cliente/reset-senha?token=${token}`;
      sendPasswordResetEmail({ nome: account.nome, email: account.email, resetUrl }).catch(console.error);

      res.json({ message: "Se o e-mail existir, você receberá as instruções." });
    } catch (error) {
      console.error("Error forgot password:", error);
      res.status(500).json({ message: "Erro ao processar solicitação" });
    }
  });

  // Reset password with token (public)
  app.post("/api/client/reset-password", async (req, res) => {
    try {
      const ip = getClientIp(req);
      if (!checkResetRateLimit(ip)) {
        return res.status(429).json({ message: "Muitas tentativas. Aguarde 15 minutos." });
      }
      const schema = z.object({
        token: z.string().min(1),
        novaSenha: z.string().min(8, "Senha deve ter pelo menos 8 caracteres"),
      });
      const { token, novaSenha } = schema.parse(req.body);
      const account = await storage.getClientAccountByResetToken(token);
      if (!account || !account.resetTokenExpiry || new Date() > account.resetTokenExpiry) {
        return res.status(400).json({ message: "Link inválido ou expirado. Solicite um novo." });
      }
      const senhaHash = await bcrypt.hash(novaSenha, 12);
      await storage.updateClientPassword(account.id, senhaHash);
      await storage.clearResetToken(account.id);
      audit("client.password.reset", { accountId: account.id, ip: getClientIp(req)});
      res.json({ message: "Senha redefinida com sucesso. Faça login com sua nova senha." });
    } catch (error) {
      console.error("Error reset password:", error);
      res.status(500).json({ message: "Erro ao redefinir senha" });
    }
  });

  // ==================== Support Tickets ====================

  // Cliente: listar meus tickets
  app.get("/api/client/tickets", isClientAuthenticated, async (req, res) => {
    try {
      const tickets = await storage.getSupportTicketsByClient(req.clientAccountId!);
      res.json(tickets);
    } catch (error) {
      console.error("Error listing client tickets:", error);
      res.status(500).json({ message: "Erro ao listar tickets" });
    }
  });

  // Cliente: detalhe do ticket
  app.get("/api/client/tickets/:id", isClientAuthenticated, async (req, res) => {
    try {
      const ticket = await storage.getSupportTicket(req.params.id);
      if (!ticket || ticket.clientAccountId !== req.clientAccountId) {
        return res.status(404).json({ message: "Ticket não encontrado" });
      }
      res.json(ticket);
    } catch (error) {
      console.error("Error getting ticket:", error);
      res.status(500).json({ message: "Erro ao buscar ticket" });
    }
  });

  // Cliente: criar ticket
  app.post("/api/client/tickets", isClientAuthenticated, async (req, res) => {
    try {
      if (!checkTicketCreateRateLimit(req.clientAccountId!)) {
        return res.status(429).json({
          message: "Muitos tickets criados recentemente. Aguarde e tente novamente mais tarde.",
        });
      }
      const schema = z.object({
        assunto: z.string().min(3).max(200),
        categoria: z.enum(["camera", "conta", "duvida", "outro"]),
        prioridade: z.enum(["baixa", "media", "alta"]).default("media"),
        mensagem: z.string().min(1).max(5000),
      });
      const data = schema.parse(req.body);
      const account = await storage.getClientAccount(req.clientAccountId!);
      if (!account) return res.status(404).json({ message: "Conta não encontrada" });

      const ticket = await storage.createSupportTicket({
        clientAccountId: account.id,
        assunto: data.assunto,
        categoria: data.categoria,
        prioridade: data.prioridade,
        mensagem: data.mensagem,
        autorNome: account.nome,
      });

      sendNewTicketEmail({
        ticketId: ticket.id,
        assunto: data.assunto,
        clienteNome: account.nome,
        categoria: data.categoria,
        prioridade: data.prioridade,
        mensagem: data.mensagem,
      }).catch(console.error);

      audit("support.ticket.created", { clientAccountId: account.id, ticketId: ticket.id });
      res.status(201).json(ticket);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos" });
      }
      console.error("Error creating ticket:", error);
      res.status(500).json({ message: "Erro ao criar ticket" });
    }
  });

  // Cliente: responder no ticket
  app.post("/api/client/tickets/:id/messages", isClientAuthenticated, async (req, res) => {
    try {
      if (!checkTicketMessageRateLimit(req.clientAccountId!)) {
        return res.status(429).json({
          message: "Muitas mensagens enviadas. Aguarde um pouco antes de enviar mais.",
        });
      }
      const { mensagem } = z.object({ mensagem: z.string().min(1).max(5000) }).parse(req.body);
      const ticket = await storage.getSupportTicket(req.params.id);
      if (!ticket || ticket.clientAccountId !== req.clientAccountId) {
        return res.status(404).json({ message: "Ticket não encontrado" });
      }
      if (ticket.status === "fechado") {
        return res.status(400).json({ message: "Ticket está fechado" });
      }
      const account = await storage.getClientAccount(req.clientAccountId!);
      if (!account) return res.status(404).json({ message: "Conta não encontrada" });

      const msg = await storage.addSupportMessage({
        ticketId: ticket.id,
        autorTipo: "cliente",
        autorId: account.id,
        autorNome: account.nome,
        mensagem,
      });
      res.status(201).json(msg);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos" });
      }
      console.error("Error adding message:", error);
      res.status(500).json({ message: "Erro ao enviar mensagem" });
    }
  });

  // Admin: listar todos (com filtro)
  app.get("/api/admin/tickets", isAdminAuthenticated, async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const tickets = await storage.getSupportTickets(status);
      res.json(tickets);
    } catch (error) {
      console.error("Error listing tickets:", error);
      res.status(500).json({ message: "Erro ao listar tickets" });
    }
  });

  // Admin: count para badge
  app.get("/api/admin/tickets/count-open", isAdminAuthenticated, async (req, res) => {
    try {
      const count = await storage.countOpenSupportTickets();
      res.json({ count });
    } catch (error) {
      res.status(500).json({ message: "Erro ao contar tickets" });
    }
  });

  // Admin: detalhe
  app.get("/api/admin/tickets/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const ticket = await storage.getSupportTicket(req.params.id);
      if (!ticket) return res.status(404).json({ message: "Ticket não encontrado" });
      res.json(ticket);
    } catch (error) {
      console.error("Error getting ticket:", error);
      res.status(500).json({ message: "Erro ao buscar ticket" });
    }
  });

  // Admin: responder
  app.post("/api/admin/tickets/:id/messages", isAdminAuthenticated, async (req, res) => {
    try {
      const { mensagem } = z.object({ mensagem: z.string().min(1).max(5000) }).parse(req.body);
      const ticket = await storage.getSupportTicket(req.params.id);
      if (!ticket) return res.status(404).json({ message: "Ticket não encontrado" });
      const admin = await storage.getAdminAccount(req.adminAccountId!);
      if (!admin) return res.status(404).json({ message: "Admin não encontrado" });

      const msg = await storage.addSupportMessage({
        ticketId: ticket.id,
        autorTipo: "admin",
        autorId: admin.id,
        autorNome: admin.nome,
        mensagem,
      });
      // Se ticket está "aberto", move para "em_andamento" automaticamente
      if (ticket.status === "aberto") {
        await storage.updateSupportTicket(ticket.id, { status: "em_andamento" });
      }
      res.status(201).json(msg);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos" });
      }
      console.error("Error adding admin message:", error);
      res.status(500).json({ message: "Erro ao enviar mensagem" });
    }
  });

  // Admin: atualizar status/prioridade
  app.patch("/api/admin/tickets/:id", isAdminAuthenticated, async (req, res) => {
    try {
      const schema = z.object({
        status: z.enum(["aberto", "em_andamento", "resolvido", "fechado"]).optional(),
        prioridade: z.enum(["baixa", "media", "alta"]).optional(),
      });
      const patch = schema.parse(req.body);
      const updated = await storage.updateSupportTicket(req.params.id, patch);
      if (!updated) return res.status(404).json({ message: "Ticket não encontrado" });
      audit("support.ticket.updated", { adminId: req.adminAccountId, ticketId: req.params.id, status: patch.status, prioridade: patch.prioridade });
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Dados inválidos" });
      }
      console.error("Error updating ticket:", error);
      res.status(500).json({ message: "Erro ao atualizar ticket" });
    }
  });

  return httpServer;
}
