import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { storage } from "./storage";
import { log } from "./index";

const execFileAsync = promisify(execFile);
const VIDEOS_DIR = path.resolve("uploads/videos");

function ensureVideosDir() {
  if (!fs.existsSync(VIDEOS_DIR)) {
    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    log("Diretório de vídeos criado: " + VIDEOS_DIR, "timelapse-job");
  }
}

async function processTimelapse(timelapse: {
  id: string;
  cameraId: string;
  nome: string | null;
  dataInicio: Date | string;
  dataFim: Date | string;
  fps: number | null;
}) {
  const fps = timelapse.fps || 30;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const dataInicio = typeof timelapse.dataInicio === "string"
    ? timelapse.dataInicio
    : timelapse.dataInicio.toISOString().split("T")[0];
  const dataFim = typeof timelapse.dataFim === "string"
    ? timelapse.dataFim
    : timelapse.dataFim.toISOString().split("T")[0];

  if (!DATE_RE.test(dataInicio) || !DATE_RE.test(dataFim)) {
    await storage.updateTimelapse(timelapse.id, {
      status: "erro",
      erroMensagem: "Formato de data inválido no timelapse",
    } as any);
    return;
  }

  log(`Processando timelapse "${timelapse.nome || timelapse.id}" (${dataInicio} a ${dataFim}, ${fps}fps)`, "timelapse-job");

  await storage.updateTimelapse(timelapse.id, {
    status: "processando",
    progresso: 0,
  } as any);

  // Buscar capturas do periodo
  const captures = await storage.getAllCaptures(timelapse.cameraId, dataInicio, dataFim);

  if (!captures || captures.length === 0) {
    await storage.updateTimelapse(timelapse.id, {
      status: "erro",
      erroMensagem: "Nenhuma captura encontrada no período selecionado",
    } as any);
    log(`Timelapse "${timelapse.nome || timelapse.id}": sem capturas no período`, "timelapse-job");
    return;
  }

  // Ordenar capturas por data (mais antiga primeiro)
  const sorted = captures.sort((a, b) => {
    const da = a.capturadoEm ? new Date(a.capturadoEm).getTime() : 0;
    const db = b.capturadoEm ? new Date(b.capturadoEm).getTime() : 0;
    return da - db;
  });

  // Filtrar capturas que tem arquivo no disco
  const validCaptures = sorted.filter((c) => c.imagemPath && fs.existsSync(path.resolve(c.imagemPath)));

  if (validCaptures.length < 2) {
    await storage.updateTimelapse(timelapse.id, {
      status: "erro",
      erroMensagem: `Apenas ${validCaptures.length} captura(s) com arquivo válido. Mínimo: 2`,
    } as any);
    log(`Timelapse "${timelapse.nome || timelapse.id}": capturas insuficientes (${validCaptures.length})`, "timelapse-job");
    return;
  }

  await storage.updateTimelapse(timelapse.id, { progresso: 10 } as any);

  // Criar arquivo de lista para o ffmpeg (concat demuxer)
  const listDir = path.join(VIDEOS_DIR, "temp");
  if (!fs.existsSync(listDir)) {
    fs.mkdirSync(listDir, { recursive: true });
  }
  const listFile = path.join(listDir, `${timelapse.id}.txt`);
  const listContent = validCaptures
    .map((c) => `file '${path.resolve(c.imagemPath!)}'`)
    .map((line) => `${line}\nduration ${1 / fps}`)
    .join("\n");
  fs.writeFileSync(listFile, listContent);

  await storage.updateTimelapse(timelapse.id, { progresso: 20 } as any);

  // Gerar video com ffmpeg
  const outputFilename = `${timelapse.id}.mp4`;
  const outputPath = path.join(VIDEOS_DIR, outputFilename);

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", listFile,
      "-vf", `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath,
    ], {
      timeout: 600_000, // 10 min max
    });
  } catch (error: any) {
    await storage.updateTimelapse(timelapse.id, {
      status: "erro",
      erroMensagem: `Erro do ffmpeg: ${error.message?.substring(0, 200)}`,
    } as any);
    log(`Timelapse "${timelapse.nome || timelapse.id}": erro ffmpeg — ${error.message}`, "timelapse-job");
    // Cleanup
    if (fs.existsSync(listFile)) fs.unlinkSync(listFile);
    return;
  }

  // Cleanup lista temporaria
  if (fs.existsSync(listFile)) fs.unlinkSync(listFile);

  await storage.updateTimelapse(timelapse.id, { progresso: 90 } as any);

  // Obter tamanho e duracao do video
  let tamanhoBytes = 0;
  let duracaoSegundos = 0;
  try {
    const stat = fs.statSync(outputPath);
    tamanhoBytes = stat.size;
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      outputPath,
    ]);
    duracaoSegundos = Math.round(parseFloat(stdout.trim()) || 0);
  } catch {
    // nao critico
  }

  const videoUrl = `/api/videos/${outputFilename}`;

  await storage.updateTimelapse(timelapse.id, {
    status: "pronto",
    progresso: 100,
    videoUrl,
    videoPath: outputPath,
    tamanhoBytes,
    duracaoSegundos,
    totalFrames: validCaptures.length,
    completedAt: new Date(),
  } as any);

  const sizeMB = (tamanhoBytes / 1024 / 1024).toFixed(1);
  log(
    `Timelapse "${timelapse.nome || timelapse.id}" pronto: ${validCaptures.length} frames, ${duracaoSegundos}s, ${sizeMB}MB`,
    "timelapse-job",
  );
}

async function checkQueue() {
  try {
    const all = await storage.getTimelapses();
    const pending = all.filter((t) => t.status === "na_fila");

    if (pending.length === 0) return;

    // Processar um de cada vez
    const next = pending[pending.length - 1]; // mais antigo primeiro
    await processTimelapse(next);
  } catch (err: any) {
    log(`Erro ao verificar fila: ${err.message}`, "timelapse-job");
  }
}

export function startTimelapseJob() {
  ensureVideosDir();
  log("Job de timelapse iniciado (verifica fila a cada 30s)", "timelapse-job");

  setInterval(() => {
    checkQueue();
  }, 30_000);
}
