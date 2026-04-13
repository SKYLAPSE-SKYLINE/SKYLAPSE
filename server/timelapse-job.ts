import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { storage } from "./storage";
import { log } from "./index";
import { getFromR2, uploadToR2 } from "./r2";

const execFileAsync = promisify(execFile);

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

  // Criar diretório temporário para baixar imagens do R2
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `timelapse-${timelapse.id}-`));

  try {
    // Baixar capturas do R2 para disco temporário
    const validPaths: string[] = [];
    let downloadedCount = 0;

    for (const capture of sorted) {
      if (!capture.imagemPath) continue;
      try {
        const buffer = await getFromR2(capture.imagemPath);
        const localPath = path.join(tmpDir, `frame_${String(downloadedCount).padStart(6, "0")}.jpg`);
        fs.writeFileSync(localPath, buffer);
        validPaths.push(localPath);
        downloadedCount++;
      } catch {
        // Skip captures that fail to download
      }
    }

    if (validPaths.length < 2) {
      await storage.updateTimelapse(timelapse.id, {
        status: "erro",
        erroMensagem: `Apenas ${validPaths.length} captura(s) com arquivo válido. Mínimo: 2`,
      } as any);
      log(`Timelapse "${timelapse.nome || timelapse.id}": capturas insuficientes (${validPaths.length})`, "timelapse-job");
      return;
    }

    await storage.updateTimelapse(timelapse.id, { progresso: 30 } as any);

    // Criar arquivo de lista para o ffmpeg (concat demuxer)
    const listFile = path.join(tmpDir, "list.txt");
    const listContent = validPaths
      .map((p) => `file '${p}'`)
      .map((line) => `${line}\nduration ${1 / fps}`)
      .join("\n");
    fs.writeFileSync(listFile, listContent);

    await storage.updateTimelapse(timelapse.id, { progresso: 40 } as any);

    // Gerar video com ffmpeg
    const outputPath = path.join(tmpDir, `${timelapse.id}.mp4`);

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
      return;
    }

    await storage.updateTimelapse(timelapse.id, { progresso: 80 } as any);

    // Ler vídeo e fazer upload para R2
    const videoBuffer = fs.readFileSync(outputPath);
    const r2Key = `videos/${timelapse.id}.mp4`;
    await uploadToR2(r2Key, videoBuffer, "video/mp4");

    await storage.updateTimelapse(timelapse.id, { progresso: 95 } as any);

    // Obter tamanho e duracao do video
    let tamanhoBytes = videoBuffer.length;
    let duracaoSegundos = 0;
    try {
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

    await storage.updateTimelapse(timelapse.id, {
      status: "pronto",
      progresso: 100,
      videoUrl: r2Key,
      videoPath: r2Key,
      tamanhoBytes,
      duracaoSegundos,
      totalFrames: validPaths.length,
      completedAt: new Date(),
    } as any);

    const sizeMB = (tamanhoBytes / 1024 / 1024).toFixed(1);
    log(
      `Timelapse "${timelapse.nome || timelapse.id}" pronto: ${validPaths.length} frames, ${duracaoSegundos}s, ${sizeMB}MB`,
      "timelapse-job",
    );
  } finally {
    // Cleanup temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function checkQueue() {
  try {
    const all = await storage.getTimelapses();
    const pending = all.filter((t) => t.status === "na_fila");

    if (pending.length === 0) return;

    // Processar um de cada vez
    const next = pending[pending.length - 1]; // mais antigo primeiro
    if (!next.cameraId) return;
    await processTimelapse({ ...next, cameraId: next.cameraId });
  } catch (err: any) {
    log(`Erro ao verificar fila: ${err.message}`, "timelapse-job");
  }
}

export function startTimelapseJob() {
  log("Job de timelapse iniciado (R2 storage, verifica fila a cada 30s)", "timelapse-job");

  setInterval(() => {
    checkQueue();
  }, 30_000);
}
