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
 * What the extraction learned about the file on the way past. Only the PDF
 * extractor counts pages and spots scanned ones today; every other format
 * answers with the text alone, and the caller leaves those columns untouched
 * rather than stamping a guess.
 */
export interface ExtractedDocument {
  text: string;
  visionUsed: boolean;
  pageCount?: number;
  scannedPagesDetected?: number;
  ocrApplied?: boolean;
}

/**
 * Extract text from file bytes, routing to the correct extractor. Returns
 * `[extractedText, visionWasUsed]`. Throws when the file type is unsupported.
 *
 * Prefer {@link extractDocument} when the caller records what the file is —
 * page count, scanned pages, whether OCR ran; this pair form drops them.
 */
export async function extractText(
  fileBytes: Uint8Array,
  filename: string,
  options: ExtractTextOptions = {},
): Promise<[string, boolean]> {
  const extracted = await extractDocument(fileBytes, filename, options);
  return [extracted.text, extracted.visionUsed];
}

/**
 * The same routing, keeping what the extractor learned. The PDF leg carries
 * the page count and the scanned-page tally the operator sees on the
 * document row ("Image pages: 3 — OCR unavailable"); before this the ingest
 * lane read them and threw them away, so those rows never appeared.
 */
export async function extractDocument(
  fileBytes: Uint8Array,
  filename: string,
  options: ExtractTextOptions = {},
): Promise<ExtractedDocument> {
  const visionClient = options.visionClient ?? null;
  const processImages = options.processImages ?? true;
  const suffix = extname(filename).toLowerCase();

  if (PDF_EXTENSIONS.has(suffix)) {
    const result = await extractTextFromPdfBytes(fileBytes, filename, {
      visionClient,
      processImages,
      onProgress: options.onProgress,
    });
    return {
      text: result.text,
      visionUsed: result.visionUsed,
      pageCount: result.pageCount,
      scannedPagesDetected: result.scannedPagesDetected,
      ocrApplied: result.ocrApplied,
    };
  }

  if (DOCX_EXTENSIONS.has(suffix)) {
    return pair(
      await extractTextFromDocxBytes(fileBytes, filename, {
        visionClient,
        processImages,
      }),
    );
  }

  if (PPTX_EXTENSIONS.has(suffix)) {
    return pair(
      await extractTextFromPptxBytes(fileBytes, filename, {
        visionClient,
        processImages,
      }),
    );
  }

  if (XLSX_EXTENSIONS.has(suffix)) {
    return pair(await extractTextFromXlsxBytes(fileBytes, filename));
  }

  if (ODT_EXTENSIONS.has(suffix)) {
    return pair(
      await extractTextFromOdtBytes(fileBytes, filename, { processImages }),
    );
  }

  if (SUPPORTED_IMAGE_EXTENSIONS.has(suffix)) {
    return pair(
      await extractTextFromImageBytes(fileBytes, filename, { visionClient }),
    );
  }

  if (SUPPORTED_TEXT_EXTENSIONS.has(suffix)) {
    return pair(await extractTextFromTextBytes(fileBytes, filename));
  }

  console.warn(`Unsupported file type: ${suffix}`);
  throw new Error(`Unsupported file type: ${suffix}`);
}

/** The `[text, visionUsed, …]` extractors, in the richer shape. The docx leg
 * carries a third element (its per-image page indices) that no caller of this
 * router reads. */
function pair([text, visionUsed]: readonly [
  string,
  boolean,
  ...unknown[],
]): ExtractedDocument {
  return { text, visionUsed };
}
