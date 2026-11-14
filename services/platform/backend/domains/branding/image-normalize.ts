import { encodeImage } from '@tale/ui/images/encode';
import { IMAGE_MAX_BYTES, PNG_QUALITY } from '@tale/ui/images/responsive';
import sharp from 'sharp';

import type { BrandingImageType } from '../../core/branding/file_utils.ts';
import { BrandingError } from './errors.ts';

/**
 * The box a raster branding image is stored within, in image pixels: the
 * largest slot the product draws it in, at device pixel ratio 2. A larger
 * upload is scaled down to fit the box, a smaller one is kept as it is.
 */
export const BRANDING_IMAGE_BOX = {
  /** The text-wordmark logo (`tale-logo-text`): 74 × 24 CSS px. */
  logo: { width: 148, height: 48 },
  /** A browser-tab icon (favicon light and dark): 32 CSS px. */
  favicon: { width: 64, height: 64 },
} as const satisfies Record<
  'logo' | 'favicon',
  { width: number; height: number }
>;

export interface StoredBrandingImage {
  bytes: Buffer;
  /** The extension the stored file gets, which its MIME type follows. */
  ext: string;
}

/**
 * Normalise an uploaded branding image before it is stored: a PNG, JPEG or
 * WebP is scaled into its box and re-encoded as a palette PNG through the
 * shared encoder (`@tale/ui/images/encode`), so the file on disk is the size
 * the product shows it at. A PNG is the one format every tab and browser
 * reads as a favicon, and a palette keeps a flat logo exact in a few
 * kilobytes at this size.
 *
 * An SVG stays an SVG: it is vector art, so no size is wasted, and it has
 * already passed the active-content gate. An ICO stays as uploaded: sharp
 * cannot read or write the format.
 */
export async function normalizeBrandingImage(
  type: BrandingImageType,
  buffer: Buffer,
  ext: string,
): Promise<StoredBrandingImage> {
  if (ext === 'svg' || ext === 'ico') return { bytes: buffer, ext };
  const box =
    type === 'logo' ? BRANDING_IMAGE_BOX.logo : BRANDING_IMAGE_BOX.favicon;
  try {
    await sharp(buffer).metadata();
  } catch (error) {
    console.warn(`[branding] ${type} is not a readable raster image`, error);
    throw new BrandingError(
      'IMAGE_MIME_UNSUPPORTED',
      `Image ${type} could not be read as a PNG, JPEG or WebP image`,
    );
  }
  const scaled = sharp(buffer).rotate().resize({
    width: box.width,
    height: box.height,
    fit: 'inside',
    withoutEnlargement: true,
  });
  try {
    const { bytes } = await encodeImage(scaled, {
      format: 'png',
      quality: PNG_QUALITY,
      label: type,
      maxBytes: IMAGE_MAX_BYTES,
    });
    return { bytes, ext: 'png' };
  } catch (error) {
    console.warn(
      `[branding] ${type} could not be encoded within budget`,
      error,
    );
    throw new BrandingError(
      'IMAGE_TOO_LARGE',
      `Image ${type} could not be reduced to the stored size`,
    );
  }
}
