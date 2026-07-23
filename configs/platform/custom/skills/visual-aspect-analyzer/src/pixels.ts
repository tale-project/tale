// Pixel-level helpers for the driver's frame diffing. `noiseEnergy` is pure and
// dependency-free (unit-tested with synthetic buffers); `decodePng` turns a
// PNG screenshot into raw RGBA via pngjs.

import { PNG } from 'pngjs';

export type DecodedImage = {
  width: number;
  height: number;
  /** RGBA bytes, length = width * height * 4. */
  data: Uint8Array;
};

/**
 * Temporal noise between two equal-shape RGBA buffers, normalized 0..1: the
 * mean absolute per-byte difference over 255. Identical frames score 0; a
 * shimmering/dithering region scores high. Buffers of differing length are
 * compared over their overlap.
 */
export function noiseEnergy(prev: Uint8Array, cur: Uint8Array): number {
  const n = Math.min(prev.length, cur.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs((prev[i] ?? 0) - (cur[i] ?? 0));
  return sum / n / 255;
}

/**
 * Crop a sub-region (in pixel coordinates) out of a decoded RGBA image, floored
 * to the pixel grid and clamped to the image. A clip that is empty or fully off
 * the image returns null — which also handles a NaN clip (`!(NaN > 0)` is true).
 * This lets the driver take ONE viewport screenshot per keyframe and extract
 * each element's sub-rect in-process, instead of a screenshot per element.
 */
export function cropRGBA(
  img: DecodedImage,
  clip: { x: number; y: number; width: number; height: number },
): Uint8Array | null {
  const x = Math.max(0, Math.floor(clip.x));
  const y = Math.max(0, Math.floor(clip.y));
  const w = Math.min(Math.floor(clip.x + clip.width), img.width) - x;
  const h = Math.min(Math.floor(clip.y + clip.height), img.height) - y;
  if (!(w > 0 && h > 0)) return null;
  const out = new Uint8Array(w * h * 4);
  const stride = img.width * 4;
  for (let row = 0; row < h; row++) {
    const src = (y + row) * stride + x * 4;
    out.set(img.data.subarray(src, src + w * 4), row * w * 4);
  }
  return out;
}

/** Decode PNG screenshot bytes to raw RGBA. */
export function decodePng(bytes: Uint8Array): DecodedImage {
  let png: PNG;
  try {
    png = PNG.sync.read(Buffer.from(bytes));
  } catch (cause) {
    // pngjs throws terse, context-free errors ("invalid signature"); wrap so a
    // corrupt or truncated screenshot points at the decode step, not pngjs.
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Failed to decode PNG screenshot: ${reason}`, { cause });
  }
  return { width: png.width, height: png.height, data: png.data };
}
