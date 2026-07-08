/**
 * PNG → WebP encoding for the docs screenshot pipeline, with the docs image
 * budget enforced at capture time: `services/docs/tests/images.test.ts` fails
 * any asset at or over 200 KB, so encode to a safety margin below it and fail
 * loudly rather than ship a mushy image — an over-budget capture means the
 * crop is too loose, not that the quality floor is too high.
 */

import sharp from 'sharp';

/** Stay comfortably under the 200 KB test ceiling. */
const MAX_BYTES = 190 * 1024;

/** Descending quality ladder; below the floor the caller must crop tighter. */
const QUALITY_LADDER = [82, 74, 66, 58] as const;

interface EncodedWebp {
  readonly bytes: Buffer;
  readonly quality: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Encode a PNG screenshot buffer to WebP under the size budget, walking the
 * quality ladder. Throws when even the lowest rung is over budget.
 */
export async function encodeWebp(
  png: Buffer,
  label: string,
): Promise<EncodedWebp> {
  const meta = await sharp(png).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  for (const quality of QUALITY_LADDER) {
    const bytes = await sharp(png).webp({ quality, effort: 6 }).toBuffer();
    if (bytes.byteLength < MAX_BYTES) {
      return { bytes, quality, width, height };
    }
  }
  throw new Error(
    `Shot "${label}" is ${Math.round(png.byteLength / 1024)} KB source and stays over ` +
      `${Math.round(MAX_BYTES / 1024)} KB even at quality ${QUALITY_LADDER.at(-1)} — ` +
      `crop tighter (element/clip) instead of lowering quality further.`,
  );
}
