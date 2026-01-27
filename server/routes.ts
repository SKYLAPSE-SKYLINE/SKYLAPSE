import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, registerAuthRoutes } from "./replit_integrations/auth";
import { 
  insertClientSchema, 
  insertLocationSchema, 
  insertCameraSchema,
  insertTimelapseSchema
} from "@shared/schema";
import { z } from "zod";
import { testCameraConnection, fetchSnapshot } from "./camera-service";

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

      const cameraConfig = {
        hostname: camera.hostname,
        portaHttp: camera.portaHttp,
        usuario: camera.usuario,
        senha: camera.senha,
        marca: camera.marca || "reolink",
      };

      let result = await fetchSnapshot(cameraConfig, false);
      
      if (!result.sucesso) {
        result = await fetchSnapshot(cameraConfig, true);
      }

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

  return httpServer;
}
