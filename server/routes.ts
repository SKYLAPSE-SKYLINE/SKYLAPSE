import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, registerAuthRoutes } from "./replit_integrations/auth";
import { 
  insertClientSchema, 
  insertLocationSchema, 
  insertCameraSchema,
  insertTimelapseSchema,
  insertClientAccountSchema,
} from "@shared/schema";
import { z } from "zod";
import { testCameraConnection, fetchSnapshot } from "./camera-service";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      clientAccountId?: string;
    }
  }
}

const CLIENT_JWT_SECRET = process.env.SESSION_SECRET! + "_client";

export const isClientAuthenticated: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.["skylapse-client-token"];
  if (!token) {
    return res.status(401).json({ message: "Não autenticado" });
  }
  try {
    const payload = jwt.verify(token, CLIENT_JWT_SECRET) as { clientAccountId: string };
    // Check account still exists and is active on every request — revokes deactivated sessions immediately
    const account = await storage.getClientAccountStatus(payload.clientAccountId);
    if (!account || account.status !== "ativo") {
      res.clearCookie("skylapse-client-token");
      return res.status(401).json({ message: "Conta inativa ou não encontrada" });
    }
    req.clientAccountId = payload.clientAccountId;
    next();
  } catch {
    return res.status(401).json({ message: "Sessão expirada ou inválida" });
  }
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Setup authentication
  await setupAuth(app);
  registerAuthRoutes(app);

  // Admin Stats
  app.get("/api/admin/stats", isAuthenticated, async (req, res) => {
    try {
      const stats = await storage.getStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // Clients CRUD
  app.get("/api/admin/clients", isAuthenticated, async (req, res) => {
    try {
      const clients = await storage.getClients();
      res.json(clients);
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  app.get("/api/admin/clients/:id", isAuthenticated, async (req, res) => {
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

  app.post("/api/admin/clients", isAuthenticated, async (req, res) => {
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

  app.put("/api/admin/clients/:id", isAuthenticated, async (req, res) => {
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

  app.delete("/api/admin/clients/:id", isAuthenticated, async (req, res) => {
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
  app.get("/api/admin/locations", isAuthenticated, async (req, res) => {
    try {
      const locations = await storage.getLocations();
      res.json(locations);
    } catch (error) {
      console.error("Error fetching locations:", error);
      res.status(500).json({ message: "Failed to fetch locations" });
    }
  });

  app.get("/api/admin/locations/:id", isAuthenticated, async (req, res) => {
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

  app.post("/api/admin/locations", isAuthenticated, async (req, res) => {
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

  app.put("/api/admin/locations/:id", isAuthenticated, async (req, res) => {
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

  app.delete("/api/admin/locations/:id", isAuthenticated, async (req, res) => {
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
  app.get("/api/admin/cameras", isAuthenticated, async (req, res) => {
    try {
      const cameras = await storage.getCameras();
      res.json(cameras);
    } catch (error) {
      console.error("Error fetching cameras:", error);
      res.status(500).json({ message: "Failed to fetch cameras" });
    }
  });

  app.get("/api/admin/cameras/offline", isAuthenticated, async (req, res) => {
    try {
      const cameras = await storage.getOfflineCameras();
      res.json(cameras);
    } catch (error) {
      console.error("Error fetching offline cameras:", error);
      res.status(500).json({ message: "Failed to fetch offline cameras" });
    }
  });

  app.get("/api/admin/cameras/:id", isAuthenticated, async (req, res) => {
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

  app.get("/api/admin/cameras/:id/last-capture", isAuthenticated, async (req, res) => {
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

  app.get("/api/admin/cameras/:id/captures", isAuthenticated, async (req, res) => {
    try {
      const { dataInicio, dataFim } = req.query;
      const captures = await storage.getCaptures(
        req.params.id,
        dataInicio as string | undefined,
        dataFim as string | undefined
      );
      res.json(captures);
    } catch (error) {
      console.error("Error fetching captures:", error);
      res.status(500).json({ message: "Failed to fetch captures" });
    }
  });

  app.post("/api/admin/cameras", isAuthenticated, async (req, res) => {
    try {
      const data = insertCameraSchema.parse(req.body);
      const camera = await storage.createCamera(data);
      res.status(201).json(camera);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error creating camera:", error);
      res.status(500).json({ message: "Failed to create camera" });
    }
  });

  app.post("/api/admin/cameras/test", isAuthenticated, async (req, res) => {
    try {
      const { hostname, portaHttp, usuario, senha, marca } = req.body;
      
      if (!hostname || !portaHttp || !usuario || !senha) {
        return res.json({
          sucesso: false,
          mensagem: "Dados de conexão incompletos",
        });
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

      res.json({
        sucesso: result.sucesso,
        mensagem: result.mensagem,
      });
    } catch (error) {
      console.error("Error testing camera:", error);
      res.json({
        sucesso: false,
        mensagem: "Erro ao testar conexão",
      });
    }
  });

  app.get("/api/admin/cameras/:id/snapshot", isAuthenticated, async (req, res) => {
    try {
      const camera = await storage.getCamera(req.params.id);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }

      const result = await fetchSnapshot({
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

  app.put("/api/admin/cameras/:id", isAuthenticated, async (req, res) => {
    try {
      const data = insertCameraSchema.partial().parse(req.body);
      const camera = await storage.updateCamera(req.params.id, data);
      if (!camera) {
        return res.status(404).json({ message: "Camera not found" });
      }
      res.json(camera);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error updating camera:", error);
      res.status(500).json({ message: "Failed to update camera" });
    }
  });

  app.delete("/api/admin/cameras/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await storage.deleteCamera(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Camera not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting camera:", error);
      res.status(500).json({ message: "Failed to delete camera" });
    }
  });

  // Timelapses CRUD
  app.get("/api/admin/timelapses", isAuthenticated, async (req, res) => {
    try {
      const timelapses = await storage.getTimelapses();
      res.json(timelapses);
    } catch (error) {
      console.error("Error fetching timelapses:", error);
      res.status(500).json({ message: "Failed to fetch timelapses" });
    }
  });

  app.get("/api/admin/timelapses/recent", isAuthenticated, async (req, res) => {
    try {
      const timelapses = await storage.getRecentTimelapses(5);
      res.json(timelapses);
    } catch (error) {
      console.error("Error fetching recent timelapses:", error);
      res.status(500).json({ message: "Failed to fetch recent timelapses" });
    }
  });

  app.get("/api/admin/timelapses/:id", isAuthenticated, async (req, res) => {
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

  app.post("/api/admin/timelapses", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.claims?.sub;
      const data = insertTimelapseSchema.parse({
        ...req.body,
        solicitadoPor: userId,
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

  app.delete("/api/admin/timelapses/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await storage.deleteTimelapse(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Timelapse not found" });
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
  app.get("/api/admin/client-accounts", isAuthenticated, async (req, res) => {
    try {
      const accounts = await storage.getClientAccounts();
      res.json(accounts.map((a) => toSafeAccountDTO(a)));
    } catch (error) {
      console.error("Error fetching client accounts:", error);
      res.status(500).json({ message: "Failed to fetch client accounts" });
    }
  });

  app.get("/api/admin/client-accounts/:id", isAuthenticated, async (req, res) => {
    try {
      const account = await storage.getClientAccount(req.params.id);
      if (!account) return res.status(404).json({ message: "Account not found" });
      res.json(toSafeAccountDTO(account));
    } catch (error) {
      console.error("Error fetching client account:", error);
      res.status(500).json({ message: "Failed to fetch client account" });
    }
  });

  app.post("/api/admin/client-accounts", isAuthenticated, async (req, res) => {
    try {
      const data = insertClientAccountSchema.parse(req.body);
      const existing = await storage.getClientAccountByEmail(data.email);
      if (existing) {
        return res.status(409).json({ message: "Já existe uma conta com este e-mail" });
      }
      const senhaHash = await bcrypt.hash(data.senha, 10);
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
      res.status(201).json(toSafeAccountDTO(full));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error("Error creating client account:", error);
      res.status(500).json({ message: "Failed to create client account" });
    }
  });

  app.put("/api/admin/client-accounts/:id", isAuthenticated, async (req, res) => {
    try {
      const updateSchema = insertClientAccountSchema.partial().extend({
        senha: z.string().min(6).optional(),
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
      if (senha && senha.length >= 6) {
        updateData.senhaHash = await bcrypt.hash(senha, 10);
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

  app.delete("/api/admin/client-accounts/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await storage.deleteClientAccount(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Account not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting client account:", error);
      res.status(500).json({ message: "Failed to delete client account" });
    }
  });

  // Client login (JWT-based, separate from admin Replit Auth session)
  app.post("/api/client/login", async (req, res) => {
    try {
      const { email, senha } = req.body;
      if (!email || !senha) {
        return res.status(400).json({ message: "E-mail e senha são obrigatórios" });
      }
      const account = await storage.getClientAccountByEmail(email);
      if (!account) {
        return res.status(401).json({ message: "E-mail ou senha incorretos" });
      }
      if (account.status !== "ativo") {
        return res.status(403).json({ message: "Conta desativada. Entre em contato com o suporte." });
      }
      const valid = await bcrypt.compare(senha, account.senhaHash);
      if (!valid) {
        return res.status(401).json({ message: "E-mail ou senha incorretos" });
      }
      const cameraIds = await storage.getClientCameraIds(account.id);
      const token = jwt.sign(
        { clientAccountId: account.id },
        CLIENT_JWT_SECRET,
        { expiresIn: "7d" }
      );
      res.cookie("skylapse-client-token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: "lax",
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

  app.post("/api/client/logout", (req, res) => {
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
        cameraIds,
      });
    } catch (error) {
      console.error("Error fetching client me:", error);
      res.status(500).json({ message: "Erro ao buscar dados" });
    }
  });

  return httpServer;
}
