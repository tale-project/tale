// Build-time encoder for the committed responsive variants. Required peer on
// the consumer side: `sharp`, listed as an optional peer here so a component
// consumer does not install a native image library it never runs.

import type { Sharp } from 'sharp';

import {
  IMAGE_MAX_BYTES,
  IMAGE_MIN_QUALITY,
  IMAGE_QUALITY_STEP,
  type ImageFormat,
} from './responsive';

interface EncodingOptions {
  format: ImageFormat;
  quality: number;
  label: string;
  maxBytes?: number;
}

/** Keep the requested resolution and quality unless the encoded bytes exceed
 * the budget. Stop at the quality floor and fail rather than silently ship an
 * oversized or muddy image. */
export async function encodeImage(
  image: Sharp,
  {
    format,
    quality: initialQuality,
    label,
    maxBytes = IMAGE_MAX_BYTES,
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
    if (quality <= IMAGE_MIN_QUALITY) break;
    quality = Math.max(IMAGE_MIN_QUALITY, quality - IMAGE_QUALITY_STEP);
  }
  throw new Error(
    `Image "${label}" (${format}) is ${size} bytes at quality ${quality}, ` +
      `above the ${maxBytes}-byte budget. Choose a tighter source or crop; dimensions were preserved.`,
  );
}
