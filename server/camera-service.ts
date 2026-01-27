import https from "https";
import http from "http";

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

function buildSnapshotUrl(config: CameraConfig): string {
  const { hostname, portaHttp, usuario, senha, marca } = config;
  
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

function buildSnapshotUrlHttps(config: CameraConfig): string {
  const { hostname, portaHttp, usuario, senha, marca } = config;
  
  switch (marca.toLowerCase()) {
    case "reolink":
      return `https://${hostname}:${portaHttp}/cgi-bin/api.cgi?cmd=Snap&channel=0&user=${encodeURIComponent(usuario)}&password=${encodeURIComponent(senha)}`;
    case "hikvision":
      return `https://${hostname}:${portaHttp}/ISAPI/Streaming/channels/101/picture`;
    case "intelbras":
      return `https://${hostname}:${portaHttp}/cgi-bin/snapshot.cgi?channel=0&user=${encodeURIComponent(usuario)}&password=${encodeURIComponent(senha)}`;
    default:
      return `https://${hostname}:${portaHttp}/cgi-bin/api.cgi?cmd=Snap&channel=0&user=${encodeURIComponent(usuario)}&password=${encodeURIComponent(senha)}`;
  }
}

export async function fetchSnapshot(config: CameraConfig, useHttps: boolean = false): Promise<SnapshotResult> {
  return new Promise((resolve) => {
    const url = useHttps ? buildSnapshotUrlHttps(config) : buildSnapshotUrl(config);
    const { hostname, portaHttp, usuario, senha, marca } = config;
    
    const options: http.RequestOptions | https.RequestOptions = {
      timeout: 10000,
      rejectUnauthorized: false,
    };

    if (marca.toLowerCase() === "hikvision") {
      options.auth = `${usuario}:${senha}`;
    }

    const protocol = useHttps ? https : http;
    
    const req = protocol.get(url, options, (res) => {
      const chunks: Buffer[] = [];
      
      if (res.statusCode !== 200) {
        resolve({
          sucesso: false,
          mensagem: `Erro HTTP ${res.statusCode}: ${res.statusMessage}`,
        });
        return;
      }

      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers["content-type"] || "image/jpeg";
        
        if (buffer.length < 1000) {
          const text = buffer.toString("utf8");
          if (text.includes("error") || text.includes("Error") || text.includes("unauthorized")) {
            resolve({
              sucesso: false,
              mensagem: "Erro de autenticação ou resposta inválida da câmera",
            });
            return;
          }
        }

        resolve({
          sucesso: true,
          mensagem: "Snapshot capturado com sucesso",
          imageBuffer: buffer,
          contentType,
        });
      });
    });

    req.on("error", (err) => {
      if (!useHttps && (err.message.includes("ECONNREFUSED") || err.message.includes("socket hang up"))) {
        fetchSnapshot(config, true).then(resolve);
        return;
      }
      
      resolve({
        sucesso: false,
        mensagem: `Erro de conexão: ${err.message}`,
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        sucesso: false,
        mensagem: "Timeout: câmera não respondeu em 10 segundos",
      });
    });
  });
}

export async function testCameraConnection(config: CameraConfig): Promise<SnapshotResult> {
  const result = await fetchSnapshot(config, false);
  
  if (!result.sucesso) {
    const httpsResult = await fetchSnapshot(config, true);
    return httpsResult;
  }
  
  return result;
}

export function getSnapshotUrlForProxy(config: CameraConfig): string {
  return buildSnapshotUrlHttps(config);
}
