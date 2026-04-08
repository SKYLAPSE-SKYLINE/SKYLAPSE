import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { fetchSnapshot } from "./camera-service";
import { log } from "./index";
import { sendCameraOfflineEmail } from "./email-service";

const CAPTURES_DIR = path.resolve("uploads/captures");
const MAX_FAILURES_BEFORE_OFFLINE = 3;

// Track consecutive failures per camera
const failureCounts = new Map<string, number>();

function ensureCapturesDir() {
  if (!fs.existsSync(CAPTURES_DIR)) {
    fs.mkdirSync(CAPTURES_DIR, { recursive: true });
    log("Diretório de capturas criado: " + CAPTURES_DIR, "capture-job");
  }
}

async function captureCamera(camera: {
  id: string;
  nome: string;
  status: string;
  streamUrl: string | null;
  hostname: string | null;
  portaHttp: number | null;
  usuario: string | null;
  senha: string | null;
  marca: string | null;
}): Promise<boolean> {
  const result = await fetchSnapshot({
    streamUrl: camera.streamUrl,
    hostname: camera.hostname,
    portaHttp: camera.portaHttp,
    usuario: camera.usuario,
    senha: camera.senha,
    marca: camera.marca || "reolink",
  });

  if (!result.sucesso || !result.imageBuffer) {
    log(`[${camera.nome}] Falha na captura: ${result.mensagem}`, "capture-job");
    return false;
  }

  const now = new Date();
  const dateFolder = now.toISOString().split("T")[0]; // 2026-03-31
  const timestamp = now.toISOString().replace(/[:.]/g, "-"); // 2026-03-31T14-30-00-000Z
  const filename = `${camera.id}_${timestamp}.jpg`;

  const dir = path.join(CAPTURES_DIR, camera.id, dateFolder);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, result.imageBuffer);

  const imagemUrl = `/api/captures/${camera.id}/${dateFolder}/${filename}`;

  await storage.createCapture({
    cameraId: camera.id,
    imagemUrl,
    imagemPath: filePath,
    tamanhoBytes: result.imageBuffer.length,
  });

  await storage.updateCamera(camera.id, { ultimaCaptura: now } as any);

  log(
    `[${camera.nome}] Captura salva: ${(result.imageBuffer.length / 1024).toFixed(1)}KB`,
    "capture-job",
  );

  return true;
}

async function handleCaptureResult(camera: { id: string; nome: string; status: string }, success: boolean) {
  if (success) {
    // Reset failure count on success
    const prevFailures = failureCounts.get(camera.id) || 0;
    failureCounts.set(camera.id, 0);

    // Auto-recovery: if camera was offline, bring it back online
    if (camera.status === "offline") {
      await storage.updateCamera(camera.id, { status: "online" } as any);
      log(`[${camera.nome}] Camera voltou a responder — status alterado para ONLINE`, "capture-job");
    } else if (prevFailures > 0) {
      log(`[${camera.nome}] Camera respondeu após ${prevFailures} falha(s) consecutiva(s)`, "capture-job");
    }
  } else {
    // Increment failure count
    const count = (failureCounts.get(camera.id) || 0) + 1;
    failureCounts.set(camera.id, count);

    if (camera.status === "online" && count >= MAX_FAILURES_BEFORE_OFFLINE) {
      await storage.updateCamera(camera.id, { status: "offline" } as any);
      log(`[${camera.nome}] ${count} falhas consecutivas — status alterado para OFFLINE`, "capture-job");
      sendCameraOfflineEmail({ cameraNome: camera.nome }).catch(console.error);
    } else if (camera.status === "online") {
      log(`[${camera.nome}] Falha ${count}/${MAX_FAILURES_BEFORE_OFFLINE} antes de marcar offline`, "capture-job");
    }
  }
}

async function runCaptureRound() {
  const allCameras = await storage.getCameras();
  const now = new Date();

  for (const camera of allCameras) {
    if (!camera.streamUrl && !camera.hostname) continue;

    // For offline cameras, try a health check every 5 minutes
    if (camera.status === "offline") {
      const ultima = camera.ultimaCaptura ? new Date(camera.ultimaCaptura).getTime() : 0;
      const elapsed = now.getTime() - ultima;
      // Only retry offline cameras every 5 minutes to avoid hammering
      if (elapsed < 5 * 60 * 1000) continue;
    }

    const intervaloMs = (camera.intervaloCaptura || 15) * 60 * 1000;
    const ultima = camera.ultimaCaptura ? new Date(camera.ultimaCaptura).getTime() : 0;
    const elapsed = now.getTime() - ultima;

    if (camera.status === "online" && elapsed < intervaloMs) continue;

    try {
      const success = await captureCamera(camera);
      await handleCaptureResult(camera, success);
    } catch (err: any) {
      log(`[${camera.nome}] Erro inesperado: ${err.message}`, "capture-job");
      await handleCaptureResult(camera, false);
    }
  }
}

export function startCaptureJob() {
  ensureCapturesDir();
  log("Job de captura iniciado (verifica a cada 60s, offline após 3 falhas)", "capture-job");

  // Primeira execução após 10s (dar tempo do servidor subir)
  setTimeout(() => {
    runCaptureRound();
  }, 10_000);

  // Depois verifica a cada 60s
  setInterval(() => {
    runCaptureRound();
  }, 60_000);
}
