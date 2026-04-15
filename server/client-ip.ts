import type { Request } from "express";

/**
 * Retorna o IP real do cliente.
 *
 * Cloudflare (que está na frente do Render) injeta o IP original no header
 * `CF-Connecting-IP`. O req.ip do Express retorna um IP do edge da Cloudflare
 * (um 172.x diferente a cada request), que é inútil pra rate limit e audit.
 *
 * Caveat: se o atacante descobrir a URL `.onrender.com` e bater nela direto
 * (bypassando Cloudflare), pode forjar esse header. Mitigação fora do código:
 * configurar o Render pra só aceitar tráfego da Cloudflare.
 */
export function getClientIp(req: Request): string {
  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.length > 0) return cfIp;
  return req.ip || req.socket.remoteAddress || "unknown";
}
