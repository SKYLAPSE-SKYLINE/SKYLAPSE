import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { storage } from "./storage";
import { startCaptureJob } from "./capture-job";
import { startTimelapseJob } from "./timelapse-job";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// Validate SESSION_SECRET at startup
if (!process.env.SESSION_SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error("FATAL: SESSION_SECRET must be set in production");
    process.exit(1);
  }
  console.warn("⚠ SESSION_SECRET not set — using insecure default (dev only)");
  process.env.SESSION_SECRET = "skylapse-dev-secret-insecure";
} else if (process.env.SESSION_SECRET.length < 32 && process.env.NODE_ENV === "production") {
  console.error("FATAL: SESSION_SECRET must be at least 32 characters in production");
  process.exit(1);
}

const app = express();
// Confia em qualquer IP de rede privada como proxy (Render tem múltiplos hops
// internos, e pode haver Cloudflare na frente). Assim req.ip pula todos os IPs
// privados do X-Forwarded-For e retorna o primeiro IP público real do cliente.
// "loopback, linklocal, uniquelocal" cobre: 127.x, ::1, 169.254.x, 10.x,
// 172.16-31.x, 192.168.x, fc00::/7 — ranges que nunca vêm da internet.
app.set("trust proxy", "loopback, linklocal, uniquelocal");
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Limite de 50KB por payload. Todos endpoints atuais aceitam bem abaixo disso
// (maior é ticket: 200 char assunto + 5000 char mensagem ≈ 10KB). Reduzir o
// default de 100KB do Express diminui a superfície pra DoS via payload grande.
app.use(
  express.json({
    limit: "50kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "50kb" }));
app.use(cookieParser());

// Security headers
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // Allow iframes only for go2rtc stream URLs (same-origin + tailscale funnel)
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' https://*.ts.net; connect-src 'self' https://*.ts.net; font-src 'self' data:;"
  );
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  const SENSITIVE_PATHS = ["/api/admin/login", "/api/client/login", "/api/client/change-password", "/api/client/forgot-password", "/api/client/reset-password"];

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && !SENSITIVE_PATHS.includes(path)) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

async function seedAdminAccount() {
  const count = await storage.countAdminAccounts();
  if (count === 0) {
    // Generate a random password for the initial admin account
    const tempPassword = crypto.randomBytes(12).toString("base64url");
    const senhaHash = await bcrypt.hash(tempPassword, 12);
    await storage.createAdminAccount({
      nome: "Administrador",
      email: "admin@skylapse.com",
      senhaHash,
    });
    console.log("═══════════════════════════════════════════════════════");
    console.log("  SKYLAPSE — Conta admin criada automaticamente");
    console.log("  E-mail: admin@skylapse.com");
    console.log(`  Senha:  ${tempPassword}`);
    console.log("  ⚠ ANOTE ESTA SENHA — ela não será exibida novamente!");
    console.log("═══════════════════════════════════════════════════════");
  }
}

(async () => {
  await seedAdminAccount();
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "3000", 10);
  httpServer.listen(
    {
      port,
      host: process.env.HOST || "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
      startCaptureJob();
      startTimelapseJob();
    },
  );
})();
