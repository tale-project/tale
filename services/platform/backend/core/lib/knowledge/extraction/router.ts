'use node';

/**
 * File extraction router — routes files to the correct extractor by extension.
 */

import { extname } from 'node:path';

import { extractTextFromDocxBytes } from './docx';
import { extractTextFromImageBytes, SUPPORTED_IMAGE_EXTENSIONS } from './image';
import { extractTextFromOdtBytes } from './odt';
import { extractTextFromPdfBytes, type ProgressCallback } from './pdf';
import { extractTextFromPptxBytes } from './pptx';
import { extractTextFromTextBytes, SUPPORTED_TEXT_EXTENSIONS } from './text';
import type { VisionClient } from './vision_client';
import { extractTextFromXlsxBytes } from './xlsx';

export const PDF_EXTENSIONS = new Set<string>(['.pdf']);
export const DOCX_EXTENSIONS = new Set<string>(['.docx']);
export const PPTX_EXTENSIONS = new Set<string>(['.pptx']);
export const XLSX_EXTENSIONS = new Set<string>(['.xlsx']);
export const ODT_EXTENSIONS = new Set<string>(['.odt']);

export const ALL_SUPPORTED_EXTENSIONS = new Set<string>([
  ...PDF_EXTENSIONS,
  ...DOCX_EXTENSIONS,
  ...PPTX_EXTENSIONS,
  ...XLSX_EXTENSIONS,
  ...ODT_EXTENSIONS,
  ...SUPPORTED_IMAGE_EXTENSIONS,
  ...SUPPORTED_TEXT_EXTENSIONS,
]);

/** Check if a file extension is supported for extraction. */
export function isSupported(filename: string): boolean {
  return ALL_SUPPORTED_EXTENSIONS.has(extname(filename).toLowerCase());
}

/**
 * Does this file route to the IMAGE extractor? Image extraction is entirely
 * vision-backed (`extractTextFromImageBytes` yields '' without a
 * `VisionClient`), so a caller with no vision lane can decide up front that
 * the file has nothing it can index — instead of downloading, extracting
 * nothing, and reporting a failure.
 */
export function isImageFile(filename: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.has(extname(filename).toLowerCase());
}

export interface ExtractTextOptions {
  visionClient?: VisionClient | null;
  processImages?: boolean;
  onProgress?: ProgressCallback;
}

/**
 * Extract text from file bytes, routing to the correct extractor. Returns
 * `[extractedText, visionWasUsed]`. Throws when the file type is unsupported.
 */
export async function extractText(
  fileBytes: Uint8Array,
  filename: string,
  options: ExtractTextOptions = {},
): Promise<[string, boolean]> {
  const visionClient = options.visionClient ?? null;
  const processImages = options.processImages ?? true;
  const suffix = extname(filename).toLowerCase();

  if (PDF_EXTENSIONS.has(suffix)) {
    const result = await extractTextFromPdfBytes(fileBytes, filename, {
      visionClient,
      processImages,
      onProgress: options.onProgress,
    });
    return [result.text, result.visionUsed];
  }

  if (DOCX_EXTENSIONS.has(suffix)) {
    const [text, visionUsed] = await extractTextFromDocxBytes(
      fileBytes,
      filename,
      {
        visionClient,
        processImages,
      },
    );
    return [text, visionUsed];
  }

  if (PPTX_EXTENSIONS.has(suffix)) {
    return extractTextFromPptxBytes(fileBytes, filename, {
      visionClient,
      processImages,
    });
  }

  if (XLSX_EXTENSIONS.has(suffix)) {
    return extractTextFromXlsxBytes(fileBytes, filename);
  }

  if (ODT_EXTENSIONS.has(suffix)) {
    return extractTextFromOdtBytes(fileBytes, filename, { processImages });
  }

  if (SUPPORTED_IMAGE_EXTENSIONS.has(suffix)) {
    return extractTextFromImageBytes(fileBytes, filename, { visionClient });
  }

  if (SUPPORTED_TEXT_EXTENSIONS.has(suffix)) {
    return extractTextFromTextBytes(fileBytes, filename);
  }

  console.warn(`Unsupported file type: ${suffix}`);
  throw new Error(`Unsupported file type: ${suffix}`);
}
