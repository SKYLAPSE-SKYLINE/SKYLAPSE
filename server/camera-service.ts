import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Block cloud metadata endpoints, loopback addresses, and other dangerous targets.
// Note: private IP ranges (10.x, 192.168.x, 172.16.x) are intentionally allowed
// because real cameras live on LAN. Only loopback and abuse targets are blocked.
const BLOCKED_HOSTS = new Set([
  "169.254.169.254",        // AWS/GCP/Azure instance metadata
  "metadata.google.internal",
  "metadata.internal",
  "localhost",              // loopback hostname
  "0.0.0.0",               // unspecified/loopback alias
  "::1",                   // IPv6 loopback
  "[::1]",                 // IPv6 loopback (bracketed form)
]);

// Matches entire 127.0.0.0/8 loopback range
const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

// Matches URI schemes like javascript:, data:, vbscript:, ftp:
// A scheme starts with a letter followed by letters/digits/+/-/. then ":"
// Excludes IP:port patterns like "192.168.1.1:8080" since those start with digits
const NON_HTTP_SCHEME = /^[a-z][a-z0-9+\-.]*:/;

export function isSafeTarget(input: string): boolean {
  try {
    let hostname: string;

    if (input.startsWith("http://") || input.startsWith("https://")) {
      const url = new URL(input);
      if (!["http:", "https:"].includes(url.protocol)) return false;
      hostname = url.hostname.toLowerCase();
    } else {
      const stripped = input.toLowerCase();
      // Reject path/query components (bypass vector)
      if (stripped.includes("/") || stripped.includes("?")) return false;
      // Block non-http URI schemes: javascript:, data:, vbscript:, ftp:, etc.
      if (NON_HTTP_SCHEME.test(stripped)) return false;
      // Check full value before stripping port (catches "::1" → "" after split)
      if (BLOCKED_HOSTS.has(stripped)) return false;
      // Strip port if present (skip for IPv6 addresses)
      hostname = (!stripped.startsWith("[") && stripped.includes(":"))
        ? stripped.split(":")[0]
        : stripped;
    }

    if (BLOCKED_HOSTS.has(hostname)) return false;
    if (LOOPBACK_IPV4.test(hostname)) return false;

    return true;
  } catch {
    return false;
  }
}

export interface CameraConfig {
  hostname?: string | null;
  portaHttp?: number | null;
  usuario?: string | null;
  senha?: string | null;
  marca: string;
  streamUrl?: string | null;
}

interface SnapshotResult {
  sucesso: boolean;
  mensagem: string;
  imageBuffer?: Buffer;
  contentType?: string;
}

function isCompleteUrl(hostname: string): boolean {
  return (hostname.startsWith("http://") || hostname.startsWith("https://")) && 
         (hostname.includes("/cgi-bin/") || hostname.includes("?") || hostname.includes("/ISAPI/"));
}

function cleanHostname(hostname: string): string {
  let clean = hostname;
  if (clean.startsWith("http://")) clean = clean.replace("http://", "");
  if (clean.startsWith("https://")) clean = clean.replace("https://", "");
  if (clean.includes("/")) clean = clean.split("/")[0];
  if (clean.includes(":")) clean = clean.split(":")[0];
  return clean;
}

function buildSnapshotUrl(config: { hostname: string; portaHttp: number; usuario: string; senha: string; marca: string }): string {
  if (isCompleteUrl(config.hostname)) {
    console.log(`[Camera] Using complete URL provided by user`);
    return config.hostname;
  }
  
  const hostname = cleanHostname(config.hostname);
  const { portaHttp, usuario, senha, marca } = config;
  
  switch (marca.toLowerCase()) {
    case "reolink":
      return `http://${hostname}:${portaHttp}/cgi-bin/api.cgi?cmd=Snap&channel=0&user=${encodeURIComponent(usuario)}&password=${encodeURIComponent(senha)}`;
    case "hikvision":
      return `http://${hostname}:${portaHttp}/ISAPI/Streaming/channels/101/picture`;
    case "intelbras":
      return `http://${hostname}:${portaHttp}/cgi-bin/snapshot.cgi?channel=0&user=${encodeURIComponent(usuario)}&password=${encodeURIComponent(senha)}`;
    default:
      return `http://${hostname}:${portaHttp}/cgi-bin/api.cgi?cmd=Snap&channel=0&user=${encodeURIComponent(usuario)}&password=${encodeURIComponent(senha)}`;
  }
}

async function fetchRawImage(url: string, authHeader?: string): Promise<SnapshotResult> {
  // Defense-in-depth: block SSRF even if called directly with a dangerous URL
  if (!isSafeTarget(url)) {
    return { sucesso: false, mensagem: "URL bloqueada por política de segurança" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    };
    if (authHeader) headers['Authorization'] = authHeader;

    const response = await fetch(url, { method: 'GET', signal: controller.signal, headers });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { sucesso: false, mensagem: `Erro HTTP ${response.status}: ${response.statusText}` };
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length < 1000) {
      const text = buffer.toString('utf8');
      console.log(`[Camera] Small response (${buffer.length} bytes): ${text.substring(0, 500)}`);
      if (text.includes('Login has been locked')) {
        return { sucesso: false, mensagem: 'Login bloqueado temporariamente. Aguarde alguns minutos e tente novamente.' };
      }
      if (text.includes('error') || text.includes('Error') || text.includes('unauthorized') || text.includes('Unauthorized')) {
        return { sucesso: false, mensagem: 'Erro de autenticação. Verifique usuário e senha da câmera.' };
      }
      if (!contentType.includes('image')) {
        return { sucesso: false, mensagem: `Resposta inesperada da câmera: ${text.substring(0, 100)}` };
      }
    }

    console.log(`[Camera] Snapshot captured successfully, size: ${buffer.length} bytes`);
    return { sucesso: true, mensagem: 'Snapshot capturado com sucesso', imageBuffer: buffer, contentType };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { sucesso: false, mensagem: 'Timeout: câmera não respondeu em 15 segundos' };
    }
    console.error(`[Camera] Error fetching image:`, error.message);
    return { sucesso: false, mensagem: `Erro de conexão: ${error.message}` };
  }
}

export async function fetchSnapshotFromGo2rtc(streamUrl: string, source: string = 'camera1_hd'): Promise<SnapshotResult> {
  if (!isSafeTarget(streamUrl)) {
    return { sucesso: false, mensagem: "URL de stream bloqueada por política de segurança" };
  }

  const frameUrl = `${streamUrl.replace(/\/$/, '')}/api/frame.jpeg?src=${source}`;
  console.log(`[go2rtc] Capturing snapshot from: ${frameUrl}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(frameUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { sucesso: false, mensagem: `go2rtc retornou HTTP ${response.status}` };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length < 1000) {
      return { sucesso: false, mensagem: `Frame muito pequeno (${buffer.length} bytes), possível erro no stream` };
    }

    console.log(`[go2rtc] Snapshot captured successfully, size: ${buffer.length} bytes`);
    return { sucesso: true, mensagem: 'Snapshot capturado com sucesso', imageBuffer: buffer, contentType: 'image/jpeg' };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { sucesso: false, mensagem: 'Timeout: go2rtc não respondeu em 30 segundos' };
    }
    console.error(`[go2rtc] Error:`, error.message);
    return { sucesso: false, mensagem: `Erro ao capturar snapshot: ${error.message}` };
  }
}

export async function testGo2rtcConnection(streamUrl: string): Promise<{ sucesso: boolean; mensagem: string }> {
  const url = `${streamUrl.replace(/\/$/, '')}/api/streams`;
  console.log(`[go2rtc] Testing connection: ${url}`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (response.ok) {
      const data = await response.json();
      const count = Object.keys(data || {}).length;
      return { sucesso: true, mensagem: `go2rtc respondeu corretamente. ${count} stream(s) detectado(s).` };
    }
    return { sucesso: false, mensagem: `go2rtc retornou HTTP ${response.status}` };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') return { sucesso: false, mensagem: 'Timeout: go2rtc não respondeu em 10 segundos' };
    return { sucesso: false, mensagem: `Erro de conexão com go2rtc: ${error.message}` };
  }
}

export async function fetchSnapshot(config: CameraConfig): Promise<SnapshotResult> {
  if (config.streamUrl) {
    return fetchSnapshotFromGo2rtc(config.streamUrl);
  }

  if (!config.hostname || !config.portaHttp || !config.usuario || !config.senha) {
    return { sucesso: false, mensagem: 'Configuração incompleta: informe hostname, porta, usuário e senha ou uma URL de Stream.' };
  }

  const url = buildSnapshotUrl({
    hostname: config.hostname,
    portaHttp: config.portaHttp,
    usuario: config.usuario,
    senha: config.senha,
    marca: config.marca,
  });
  console.log(`[Camera] Fetching snapshot from: ${url.replace(/password=[^&]+/, 'password=***')}`);
  return fetchRawImage(url);
}

export async function testCameraConnection(config: CameraConfig): Promise<SnapshotResult> {
  return fetchSnapshot(config);
}
