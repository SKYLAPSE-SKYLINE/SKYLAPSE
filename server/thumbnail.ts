/**
 * Thumbnail resizing with in-memory LRU cache.
 *
 * The dashboards show ~400px-wide cards, so we downscale from full-res JPEGs
 * (often 1080p, ~500KB) to ~60KB. The cached result is keyed by capture id —
 * each capture is immutable once uploaded to R2, so cache entries never go
 * stale and can live forever (evicted only by size limit).
 *
 * If sharp fails for any reason (corrupt image, unexpected format), the caller
 * should fall back to streaming the original — this module throws and lets the
 * caller decide.
 */

import sharp from "sharp";
import { getFromR2 } from "./r2";

// Max resized image width in pixels. Dashboard cards are ~400px wide;
// 2× for retina screens = 800px. Anything beyond that is wasted bytes.
const THUMB_WIDTH = 800;
const THUMB_QUALITY = 75;

// Cache size: ~200 entries × ~60KB ≈ 12 MB RAM. Plenty for many cameras
// while keeping memory bounded. LRU order via Map insertion order.
const CACHE_MAX_ENTRIES = 200;
const cache = new Map<string, Buffer>();

function cacheGet(key: string): Buffer | undefined {
  const buf = cache.get(key);
  if (!buf) return undefined;
  // Touch: move to end so it's "most recent".
  cache.delete(key);
  cache.set(key, buf);
  return buf;
}

function cacheSet(key: string, buf: Buffer): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, buf);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Returns a resized JPEG for the given capture. Throws if sharp fails or
 * the R2 fetch fails — caller should catch and fall back to original.
 */
export async function getResizedThumbnail(params: {
  captureId: string;
  r2Key: string;
}): Promise<Buffer> {
  const cacheKey = `${params.captureId}:w${THUMB_WIDTH}q${THUMB_QUALITY}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const original = await getFromR2(params.r2Key);
  const resized = await sharp(original)
    .rotate() // respect EXIF orientation
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
    .toBuffer();

  cacheSet(cacheKey, resized);
  return resized;
}
