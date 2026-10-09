import type { Sharp } from 'sharp';

/** The unchanged ceiling enforced by tests/images.test.ts. */
const MAX_BYTES = 200 * 1024;
const MIN_QUALITY = 60;
const QUALITY_STEP = 2;

interface EncodingOptions {
  format: 'avif' | 'webp';
  quality: number;
  label: string;
  maxBytes?: number;
}

/** Keep the requested resolution and quality unless its encoded bytes exceed
 * the marketing budget. Like the docs capture encoder, stop at a quality
 * floor and fail rather than silently shipping an oversized or muddy image. */
export async function encodeMarketingImage(
  image: Sharp,
  {
    format,
    quality: initialQuality,
    label,
    maxBytes = MAX_BYTES,
  }: EncodingOptions,
): Promise<{ bytes: Buffer; quality: number }> {
  let quality = initialQuality;
  let size = 0;
  while (true) {
    const pipeline = image.clone();
    const bytes = await (
      format === 'avif'
        ? pipeline.avif({ quality })
        : pipeline.webp({ quality })
    ).toBuffer();
    size = bytes.byteLength;
    if (size <= maxBytes) return { bytes, quality };
    if (quality <= MIN_QUALITY) break;
    quality = Math.max(MIN_QUALITY, quality - QUALITY_STEP);
  }
  throw new Error(
    `Marketing image "${label}" (${format}) is ${size} bytes at quality ${quality}, ` +
      `above the ${maxBytes}-byte budget. Choose a tighter source or crop; dimensions were preserved.`,
  );
}
