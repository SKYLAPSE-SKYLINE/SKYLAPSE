interface CameraConfig {
  hostname: string;
  portaHttp: number;
  usuario: string;
  senha: string;
  marca: string;
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
  if (clean.startsWith("http://")) {
    clean = clean.replace("http://", "");
  }
  if (clean.startsWith("https://")) {
    clean = clean.replace("https://", "");
  }
  if (clean.includes("/")) {
    clean = clean.split("/")[0];
  }
  if (clean.includes(":")) {
    clean = clean.split(":")[0];
  }
  return clean;
}

function buildSnapshotUrl(config: CameraConfig): string {
  // Se o hostname já é uma URL completa, usa diretamente
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

export async function fetchSnapshot(config: CameraConfig): Promise<SnapshotResult> {
  const url = buildSnapshotUrl(config);
  console.log(`[Camera] Fetching snapshot from: ${url.replace(/password=[^&]+/, 'password=***')}`);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return {
        sucesso: false,
        mensagem: `Erro HTTP ${response.status}: ${response.statusText}`,
      };
    }
    
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    if (buffer.length < 1000) {
      const text = buffer.toString('utf8');
      console.log(`[Camera] Small response (${buffer.length} bytes): ${text.substring(0, 500)}`);
      
      if (text.includes('Login has been locked')) {
        return {
          sucesso: false,
          mensagem: 'Login bloqueado temporariamente. Aguarde alguns minutos e tente novamente.',
        };
      }
      
      if (text.includes('error') || text.includes('Error') || text.includes('unauthorized') || text.includes('Unauthorized')) {
        return {
          sucesso: false,
          mensagem: 'Erro de autenticação. Verifique usuário e senha da câmera.',
        };
      }
      
      if (!contentType.includes('image')) {
        return {
          sucesso: false,
          mensagem: `Resposta inesperada da câmera: ${text.substring(0, 100)}`,
        };
      }
    }
    
    console.log(`[Camera] Snapshot captured successfully, size: ${buffer.length} bytes`);
    
    return {
      sucesso: true,
      mensagem: 'Snapshot capturado com sucesso',
      imageBuffer: buffer,
      contentType,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      return {
        sucesso: false,
        mensagem: 'Timeout: câmera não respondeu em 15 segundos',
      };
    }
    
    console.error(`[Camera] Error fetching snapshot:`, error.message);
    
    return {
      sucesso: false,
      mensagem: `Erro de conexão: ${error.message}`,
    };
  }
}

export async function testCameraConnection(config: CameraConfig): Promise<SnapshotResult> {
  return fetchSnapshot(config);
}
