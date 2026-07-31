'use node';

/**
 * Smart PDF text extraction with selective Vision API usage.
 *
 * Uses pdfjs-dist (the previous implementation used PyMuPDF). Digital text is
 * extracted directly per page. Embedded raster images are detected via the page
 * operator list; large images (> {@link LARGE_IMAGE_RATIO} of the page area) on
 * low-text pages mark the page as "scanned" and are OCR'd, while smaller images
 * are described.
 *
 * Note on fidelity: pdfjs surfaces image XObjects through the operator list and
 * their placement transform, from which the on-page area ratio is derived. The
 * raw image bytes are obtained via `page.objs`; some encodings (inline images,
 * certain JPX/JBIG2 streams) may not expose decodable bytes — those images are
 * skipped with a warning rather than failing the whole document.
 */

import type { PDFPageProxy } from 'pdfjs-dist';

import { loadPdfjs } from './pdfjs_loader';
import type { VisionClient } from './vision_client';

export type ProgressCallback = (pagesDone: number, totalPages: number) => void;

export const LARGE_IMAGE_RATIO = 0.5;
export const SCANNED_PAGE_TEXT_THRESHOLD = 50;
export const MAX_PAGES = 2000;
export const MIN_IMAGE_AREA = 10_000; // ~100x100 device pixels

export interface PdfExtractionResult {
  text: string;
  visionUsed: boolean;
  scannedPagesDetected: number;
  ocrApplied: boolean;
}

export interface PdfExtractionOptions {
  visionClient?: VisionClient | null;
  processImages?: boolean;
  maxPages?: number;
  onProgress?: ProgressCallback;
}

interface DetectedImage {
  name: string;
  areaRatio: number;
}

async function extractPageText(page: PDFPageProxy): Promise<{
  text: string;
  totalTextLen: number;
  images: DetectedImage[];
}> {
  const { OPS } = await loadPdfjs();
  const viewport = page.getViewport({ scale: 1 });
  const pageArea = viewport.width * viewport.height;

  const textContent = await page.getTextContent();
  const lines = textContent.items
    .map((item) => ('str' in item ? item.str : ''))
    .filter((s) => s.length > 0);
  const text = lines.join('\n').trim();

  const images: DetectedImage[] = [];
  try {
    const opList = await page.getOperatorList();
    for (let i = 0; i < opList.fnArray.length; i += 1) {
      const fn = opList.fnArray[i];
      if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
        const args = opList.argsArray[i];
        const name =
          Array.isArray(args) && typeof args[0] === 'string' ? args[0] : '';
        // The current transform's scale approximates the painted image area.
        const transformOp = findPrecedingTransform(opList, i, OPS.transform);
        const drawnArea = Math.abs(transformOp.a * transformOp.d);
        const areaRatio = pageArea > 0 ? drawnArea / pageArea : 0;
        if (name && drawnArea >= MIN_IMAGE_AREA) {
          images.push({ name, areaRatio });
        }
      }
    }
  } catch (err) {
    console.warn(
      `Failed to read PDF operator list: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { text, totalTextLen: text.length, images };
}

interface Transform {
  a: number;
  d: number;
}

/** Find the most recent `transform` op before index `i` in the op list. */
function findPrecedingTransform(
  opList: { fnArray: number[]; argsArray: unknown[] },
  i: number,
  opsTransform: number,
): Transform {
  for (let j = i - 1; j >= 0; j -= 1) {
    if (opList.fnArray[j] === opsTransform) {
      const args = opList.argsArray[j];
      if (Array.isArray(args) && args.length >= 6) {
        const a = typeof args[0] === 'number' ? args[0] : 1;
        const d = typeof args[3] === 'number' ? args[3] : 1;
        return { a, d };
      }
    }
  }
  return { a: 1, d: 1 };
}

async function imageBytesFromPage(
  page: PDFPageProxy,
  name: string,
): Promise<Uint8Array | null> {
  try {
    const obj = await new Promise<unknown>((resolve) => {
      page.objs.get(name, resolve);
    });
    if (obj && typeof obj === 'object' && 'data' in obj) {
      const data = (obj as { data: unknown }).data;
      if (data instanceof Uint8Array) {
        return data;
      }
      if (data instanceof Uint8ClampedArray) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      }
    }
  } catch (err) {
    console.warn(
      `Failed to read PDF image '${name}': ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return null;
}

/** Extract text from PDF bytes. */
export async function extractTextFromPdfBytes(
  pdfBytes: Uint8Array,
  filename = 'document.pdf',
  options: PdfExtractionOptions = {},
): Promise<PdfExtractionResult> {
  const visionClient = options.visionClient ?? null;
  const processImages = options.processImages ?? true;
  const maxPages = options.maxPages ?? MAX_PAGES;
  const onProgress = options.onProgress;

  const { getDocument } = await loadPdfjs();
  const doc = await getDocument({
    data: pdfBytes,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const totalPages = doc.numPages;
  const pagesToProcess = Math.min(totalPages, maxPages);
  if (totalPages > maxPages) {
    console.warn(
      `PDF has ${totalPages} pages, exceeding limit of ${maxPages}. ` +
        `Only the first ${maxPages} pages will be processed.`,
    );
  }

  const pagesContent: [number, string][] = [];
  let visionUsed = false;
  let scannedPagesDetected = 0;
  let ocrApplied = false;
  let pagesDone = 0;

  for (let pageNum = 0; pageNum < pagesToProcess; pageNum += 1) {
    const page = await doc.getPage(pageNum + 1);
    try {
      const { text, totalTextLen, images } = await extractPageText(page);
      const parts: string[] = text ? [text] : [];

      const hasLargeImage = images.some(
        (img) => img.areaRatio > LARGE_IMAGE_RATIO,
      );
      const isScannedPage =
        totalTextLen < SCANNED_PAGE_TEXT_THRESHOLD && hasLargeImage;
      if (isScannedPage) {
        scannedPagesDetected += 1;
      }

      let pageVisionUsed = false;
      if (processImages && visionClient && images.length > 0) {
        for (const img of images) {
          const imageBytes = await imageBytesFromPage(page, img.name);
          if (!imageBytes) {
            continue;
          }
          try {
            if (img.areaRatio > LARGE_IMAGE_RATIO) {
              const ocrText = await visionClient.ocrImage(imageBytes);
              if (ocrText) {
                parts.push(ocrText);
                pageVisionUsed = true;
              }
            } else {
              const description = await visionClient.describeImage(imageBytes);
              if (description) {
                parts.push(`[Image: ${description}]`);
                pageVisionUsed = true;
              }
            }
          } catch (err) {
            console.warn(
              `Failed to process image on page ${pageNum + 1}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      }

      if (pageVisionUsed) {
        visionUsed = true;
        if (isScannedPage) {
          ocrApplied = true;
        }
      }

      pagesContent.push([
        pageNum,
        `--- Page ${pageNum + 1} ---\n${parts.join('\n\n')}`,
      ]);
    } finally {
      page.cleanup();
      pagesDone += 1;
      onProgress?.(pagesDone, pagesToProcess);
    }
  }

  pagesContent.sort((a, b) => a[0] - b[0]);
  const combinedText = pagesContent.map((p) => p[1]).join('\n\n');

  if (scannedPagesDetected > 0 && !visionClient) {
    console.warn(
      `PDF '${filename}': ${scannedPagesDetected} scanned page(s) detected ` +
        `but no vision client configured — text may be incomplete`,
    );
  }

  return {
    text: combinedText,
    visionUsed,
    scannedPagesDetected,
    ocrApplied,
  };
}
