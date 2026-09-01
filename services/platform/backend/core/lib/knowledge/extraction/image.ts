/**
 * Image file text extraction using the Vision API.
 *
 * Handles direct image files (PNG, JPG, etc.) by attempting OCR first, then
 * falling back to description generation for indexing.
 */

import type { VisionClient } from './vision_client';

export const SUPPORTED_IMAGE_EXTENSIONS = new Set<string>([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.tiff',
  '.tif',
]);

const MIN_OCR_TEXT_LENGTH = 20;

/**
 * Extract text from image bytes via the Vision API. First attempts OCR; if no
 * significant text is found, generates a description. Returns
 * `[text, visionUsed]`. Returns `['', false]` when no vision client is given.
 */
export async function extractTextFromImageBytes(
  imageBytes: Uint8Array,
  filename = 'image',
  options: { visionClient?: VisionClient | null } = {},
): Promise<[string, boolean]> {
  const visionClient = options.visionClient ?? null;
  if (!visionClient) {
    console.warn(
      `No vision client configured for image extraction: ${filename}. ` +
        `Image OCR requires a vision model in provider settings.`,
    );
    return ['', false];
  }

  try {
    const ocrText = await visionClient.ocrImage(imageBytes);
    if (ocrText && ocrText.trim().length > MIN_OCR_TEXT_LENGTH) {
      return [ocrText, true];
    }

    const description = await visionClient.describeImage(imageBytes);
    if (description) {
      return [`[Image: ${description}]`, true];
    }

    return ['', true];
  } catch (err) {
    console.warn(
      `Failed to extract text from image ${filename}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return ['', false];
  }
}
