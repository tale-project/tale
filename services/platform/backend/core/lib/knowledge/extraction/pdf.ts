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
 *
 * ## What a page costs to read
 *
 * A page's text is cheap. Its operator list is not: to build it pdf.js
 * decodes every image the page paints, and a scan of an A4 page at 300 dpi
 * is 26 MB of pixels. The list is therefore read only where it is used: on
 * a page with almost no text, which is the only page that can be a scan, and
 * on every page when a vision client is there to read the images.
 *
 * A PDF read from a file (`file_extraction/pdf_file.ts`) is read by ranges:
 * pdf.js asks for the bytes it needs and the rest stays on disk. It keeps
 * every range it has loaded for as long as the document is open, so the
 * document is opened again each time it has loaded its budget of bytes.
 * And an image over the caller's pixel budget is not decoded at all; a page
 * with almost no text that paints one large is still counted as a scan
 * (tale-project/tale#4942).
 *
 * This module opens no file: whoever has one hands over how to read a range
 * of it ({@link PdfSource}). It is among the rules a data migration may
 * reach (`backend/db/data-migrations.test.ts`).
 */

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

import { ExtractionError } from './errors';
import { loadPdfjs, type PdfjsModule } from './pdfjs_loader';
import type { VisionClient } from './vision_client';

export type ProgressCallback = (pagesDone: number, totalPages: number) => void;

const LARGE_IMAGE_RATIO = 0.5;
const SCANNED_PAGE_TEXT_THRESHOLD = 50;
/** The most pages of one PDF that are read; a longer PDF's later pages are
 * never read. */
export const PDF_MAX_PAGES = 2000;
const MIN_IMAGE_AREA = 10_000; // ~100x100 device pixels

/** How much of a file pdf.js may have loaded before the document is opened
 * again, unless the caller says: opening it again is the only way pdf.js
 * lets go of what it loaded. */
const REOPEN_AFTER_BYTES = 16 * 1024 * 1024;
/** The size of the ranges pdf.js asks a file for. */
const RANGE_CHUNK_BYTES = 64 * 1024;

export interface PdfExtractionResult {
  text: string;
  visionUsed: boolean;
  scannedPagesDetected: number;
  ocrApplied: boolean;
  /** Pages the document HAS — not the number processed, which {@link
   * PDF_MAX_PAGES} can cap. What the operator sees on the document row. */
  pageCount: number;
}

export interface PdfExtractionOptions {
  visionClient?: VisionClient | null;
  processImages?: boolean;
  maxPages?: number;
  onProgress?: ProgressCallback;
  /**
   * The most pixels of one image pdf.js may decode. A larger image is left
   * out of the page: it is not described or read, and a page with almost no
   * text that paints it large still counts as a scan. Unset, every image is
   * decoded, whatever it costs.
   */
  maxImagePixels?: number;
  /**
   * How much of a PDF read by ranges pdf.js may have loaded before the
   * document is opened again; 16 MiB unless said.
   */
  reopenAfterBytes?: number;
}

interface DetectedImage {
  name: string;
  areaRatio: number;
}

interface OperatorList {
  fnArray: number[];
  argsArray: unknown[];
}

interface Transform {
  a: number;
  d: number;
}

function transformAt(opList: OperatorList, index: number): Transform {
  const args = opList.argsArray[index];
  if (Array.isArray(args) && args.length >= 6) {
    const a = typeof args[0] === 'number' ? args[0] : 1;
    const d = typeof args[3] === 'number' ? args[3] : 1;
    return { a, d };
  }
  return { a: 1, d: 1 };
}

/** Find the most recent `transform` op before index `i` in the op list. */
function findPrecedingTransform(
  opList: OperatorList,
  i: number,
  opsTransform: number,
): Transform {
  for (let j = i - 1; j >= 0; j -= 1) {
    if (opList.fnArray[j] === opsTransform) {
      const args = opList.argsArray[j];
      if (Array.isArray(args) && args.length >= 6) {
        return transformAt(opList, j);
      }
    }
  }
  return { a: 1, d: 1 };
}

// ------------------------------------------------ an image that was left out

/** What pdf.js says, through `console.warn` and nowhere else, when it leaves
 * an image over `maxImageSize` out of a page. */
const IMAGE_LEFT_OUT = 'Image exceeded maximum allowed size and was removed.';

/** The reading whose warnings are being counted, and those before it. */
let counted: Promise<unknown> = Promise.resolve();

/**
 * Run `read`, and count the images pdf.js said it left out meanwhile.
 *
 * pdf.js reports an image it leaves out only as a console line, so the
 * console is listened to for as long as the page is read: `console.warn` is
 * wrapped for that long, and put back. A line says nothing of the document
 * it is about, so one page is read under the listener at a time: two
 * documents read side by side in one process would each count the other's
 * images. The wrapper is the reading's own, taken off when it ends, so it
 * neither outlives a `console.warn` that somebody else replaced meanwhile
 * nor is lost with one.
 */
function countingImagesLeftOut<T>(
  read: () => Promise<T>,
): Promise<{ value: T; leftOut: number }> {
  const turn = counted.then(async () => {
    let leftOut = 0;
    const before = console.warn;
    const listening = function listening(
      this: unknown,
      ...args: unknown[]
    ): void {
      const first = args[0];
      if (typeof first === 'string' && first.includes(IMAGE_LEFT_OUT)) {
        leftOut += 1;
      }
      Reflect.apply(before, this, args);
    };
    console.warn = listening;
    try {
      return { value: await read(), leftOut };
    } finally {
      // Still this reading's wrapper: whoever replaced it meanwhile keeps
      // theirs.
      if (console.warn === listening) console.warn = before;
    }
  });
  // The line goes on whatever this reading came to; its caller is told.
  counted = turn.then(
    () => undefined,
    () => undefined,
  );
  return turn;
}

/** The operators that change how something is painted and paint nothing. */
const STATE_OPERATORS = [
  'dependency',
  'setGState',
  'setRenderingIntent',
  'setFlatness',
  'setLineWidth',
  'setLineCap',
  'setLineJoin',
  'setMiterLimit',
  'setDash',
  'setStrokeColorSpace',
  'setFillColorSpace',
  'setStrokeColor',
  'setStrokeColorN',
  'setFillColor',
  'setFillColorN',
  'setStrokeGray',
  'setFillGray',
  'setStrokeRGBColor',
  'setFillRGBColor',
  'setStrokeCMYKColor',
  'setFillCMYKColor',
  'setStrokeTransparent',
  'setFillTransparent',
  'beginMarkedContent',
  'beginMarkedContentProps',
  'endMarkedContent',
  'markPoint',
  'markPointProps',
] as const;

/**
 * The largest share of the page a left-out image was to cover, or `null`
 * when the list does not show where one was.
 *
 * An image is painted as "save, transform, paint, restore". With the paint
 * gone, what is left is a transform that nothing is painted under: that
 * transform is the image's size on the page, as it is for an image that
 * was kept.
 */
function leftOutAreaRatio(
  opList: OperatorList,
  ops: PdfjsModule['OPS'],
  pageArea: number,
): number | null {
  // By name: an operator this pdf.js does not have is simply not there.
  const table: Readonly<Record<string, unknown>> = ops;
  const stateOps = new Set<number>(
    STATE_OPERATORS.map((name) => table[name]).filter(
      (id): id is number => typeof id === 'number',
    ),
  );
  let largest: number | null = null;
  for (let i = 0; i < opList.fnArray.length; i += 1) {
    if (opList.fnArray[i] !== ops.transform) continue;
    let j = i + 1;
    while (j < opList.fnArray.length && stateOps.has(opList.fnArray[j] ?? -1)) {
      j += 1;
    }
    if (j < opList.fnArray.length && opList.fnArray[j] !== ops.restore)
      continue;
    const { a, d } = transformAt(opList, i);
    const drawnArea = Math.abs(a * d);
    if (drawnArea < MIN_IMAGE_AREA) continue;
    const ratio = pageArea > 0 ? drawnArea / pageArea : 0;
    if (largest === null || ratio > largest) largest = ratio;
  }
  return largest;
}

/** A range of the PDF's bytes could not be read: a fault of the place it
 * is read from, not of the document. */
class UnreadableRange extends Error {
  constructor(cause: unknown) {
    super(
      `a range of the PDF could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = 'UnreadableRange';
  }
}

// ------------------------------------------------------------------ one page

async function pageText(page: PDFPageProxy): Promise<string> {
  const textContent = await page.getTextContent();
  const lines = textContent.items
    .map((item) => ('str' in item ? item.str : ''))
    .filter((s) => s.length > 0);
  return lines.join('\n').trim();
}

/**
 * The images a page paints, and whether one too large to decode covers
 * most of it.
 */
async function pageImages(
  page: PDFPageProxy,
  ops: PdfjsModule['OPS'],
  limited: boolean,
  /** Ends the wait for the page's operators when the PDF cannot be read:
   * the turn at the listener ends with it, for the next page's reading. */
  whileReadable: <T>(work: Promise<T>) => Promise<T>,
): Promise<{ images: DetectedImage[]; largeLeftOut: boolean }> {
  const viewport = page.getViewport({ scale: 1 });
  const pageArea = viewport.width * viewport.height;
  const images: DetectedImage[] = [];
  let largeLeftOut = false;
  try {
    const operators = (): Promise<OperatorList> =>
      whileReadable(page.getOperatorList());
    const { value: opList, leftOut } = limited
      ? await countingImagesLeftOut(operators)
      : { value: await operators(), leftOut: 0 };
    for (let i = 0; i < opList.fnArray.length; i += 1) {
      const fn = opList.fnArray[i];
      if (fn === ops.paintImageXObject || fn === ops.paintImageXObjectRepeat) {
        const args = opList.argsArray[i];
        const name =
          Array.isArray(args) && typeof args[0] === 'string' ? args[0] : '';
        // The current transform's scale approximates the painted image area.
        const transformOp = findPrecedingTransform(opList, i, ops.transform);
        const drawnArea = Math.abs(transformOp.a * transformOp.d);
        const areaRatio = pageArea > 0 ? drawnArea / pageArea : 0;
        if (name && drawnArea >= MIN_IMAGE_AREA) {
          images.push({ name, areaRatio });
        }
      }
    }
    if (leftOut > 0) {
      const ratio = leftOutAreaRatio(opList, ops, pageArea);
      // An image pdf.js left out, and no sign of where it was: on a page
      // with almost no text it is taken for the page's content.
      largeLeftOut = ratio === null || ratio > LARGE_IMAGE_RATIO;
    }
  } catch (err) {
    // A PDF that cannot be read is not a page without images.
    if (err instanceof UnreadableRange) throw err;
    console.warn(
      `Failed to read PDF operator list: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { images, largeLeftOut };
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
      const data = obj.data;
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

// ------------------------------------------------------------- the document

/**
 * Where a PDF's bytes are: in memory, or wherever `read` fetches a range of
 * them from — a file on disk, for the reader next door.
 */
export type PdfSource =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | {
      readonly kind: 'ranges';
      /** How many bytes the PDF is. */
      readonly size: number;
      /** The bytes from `begin` up to, not including, `end`. A function
       * of its own, called without the source it came with. */
      readonly read: (begin: number, end: number) => Promise<Uint8Array>;
    };

/** An open PDF, and how much of its file pdf.js has loaded for it. */
interface OpenPdf {
  readonly doc: PDFDocumentProxy;
  loaded(): number;
  /**
   * `work`, or the failure of a range that could not be read, whichever
   * comes first. pdf.js has no way to be told that a range it asked for
   * will never come: what it was doing would wait for it for good. A
   * function of its own, passed on without the document it came with.
   */
  readonly whileReadable: <T>(work: Promise<T>) => Promise<T>;
  /** Let go of the document and of what pdf.js loaded for it. A range
   * that arrives afterwards is dropped. */
  close(): Promise<void>;
}

async function openPdf(
  pdfjs: PdfjsModule,
  source: PdfSource,
  maxImagePixels: number | undefined,
): Promise<OpenPdf> {
  const common = {
    isEvalSupported: false,
    useSystemFonts: true,
    ...(maxImagePixels !== undefined ? { maxImageSize: maxImagePixels } : {}),
  };
  try {
    if (source.kind === 'bytes') {
      const doc = await pdfjs.getDocument({ data: source.bytes, ...common })
        .promise;
      return {
        doc,
        loaded: () => 0,
        whileReadable: (work) => work,
        close: async () => {
          await doc.destroy();
        },
      };
    }
    let loaded = 0;
    const { read } = source;
    let failed: UnreadableRange | undefined;
    let tell: ((failure: UnreadableRange) => void) | undefined;
    let closed = false;
    const fail = (error: unknown): void => {
      failed ??= new UnreadableRange(error);
      tell?.(failed);
    };
    class Ranges extends pdfjs.PDFDataRangeTransport {
      override requestDataRange(begin: number, end: number): void {
        // Nothing more is read for a document that failed or was closed.
        if (failed !== undefined || closed) return;
        read(begin, end).then((chunk) => {
          // Asked for before the document was closed, and nobody's now:
          // pdf.js throws at a range it no longer has a reader for.
          if (closed) return;
          loaded += chunk.byteLength;
          try {
            this.onDataRange(begin, chunk);
          } catch (error) {
            fail(error);
          }
        }, fail);
      }
    }
    const whileReadable = <T>(work: Promise<T>): Promise<T> => {
      if (failed !== undefined) return Promise.reject(failed);
      return new Promise<T>((resolve, reject) => {
        tell = reject;
        work.then(resolve, reject);
      });
    };
    const task = pdfjs.getDocument({
      range: new Ranges(source.size, null),
      length: source.size,
      rangeChunkSize: RANGE_CHUNK_BYTES,
      // Only what a page needs: no fetching of the rest in the background.
      disableAutoFetch: true,
      disableStream: true,
      ...common,
    });
    try {
      const doc = await whileReadable(task.promise);
      return {
        doc,
        loaded: () => loaded,
        whileReadable,
        close: async () => {
          const destroyed = doc.destroy();
          // pdf.js lets go of a document once what it was doing is done,
          // and what it was doing waits for the range that failed: such a
          // document is left behind, not waited for.
          if (failed === undefined) await letGo(destroyed);
          else leaveBehind(destroyed);
          closed = true;
        },
      };
    } catch (error) {
      if (error instanceof UnreadableRange) {
        // The document never opened, and nobody else will be handed it.
        leaveBehind(task.destroy());
        closed = true;
      }
      throw error;
    }
  } catch (error) {
    // The file could not be read, which says nothing of what is in it.
    if (error instanceof UnreadableRange) throw error;
    // pdfjs's `InvalidPDFException` / `PasswordException`: the bytes do not
    // parse as a PDF, and never will — terminal, with a sentence for a
    // person instead of the parser's own ("Invalid PDF structure.").
    throw new ExtractionError(
      'malformed',
      `The file does not parse as a PDF (${error instanceof Error ? error.message : String(error)}); it may be corrupt, encrypted, or not a PDF at all.`,
    );
  }
}

/** How long a PDF is given to let go of what it holds. */
const LET_GO_MS = 10_000;

/**
 * Wait for pdf.js to let go of a document, and not for good: it waits for
 * whatever it was doing, and what it was doing can wait for a range that
 * never comes. A document that does not let go is left behind, with a line
 * in the log; the process that read it is on its way out.
 */
async function letGo(destroyed: Promise<void>): Promise<void> {
  let waiting: NodeJS.Timeout | undefined;
  const gaveUp = new Promise<'gave up'>((resolve) => {
    waiting = setTimeout(() => resolve('gave up'), LET_GO_MS);
    waiting.unref();
  });
  try {
    if ((await Promise.race([destroyed, gaveUp])) === 'gave up') {
      console.warn(
        `[extraction] a PDF did not let go of what it held within ${LET_GO_MS / 1000} s; it is left behind`,
      );
    }
  } finally {
    clearTimeout(waiting);
  }
}

/** Let a document go without waiting for it to be gone. */
function leaveBehind(destroyed: Promise<void>): void {
  destroyed.catch((error: unknown) => {
    console.warn(
      `[extraction] a PDF that could not be read did not close cleanly: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

/** Collect what the collector can, where this process may ask it to: the
 * heavy slot's child starts with the collector exposed. */
function collectGarbage(): void {
  const gc: unknown = Reflect.get(globalThis, 'gc');
  if (typeof gc === 'function') gc();
}

/** What reading a PDF learned of it, beside its text. */
export type PdfFacts = Omit<PdfExtractionResult, 'text'>;

/**
 * Read a PDF page by page, handing each page's text over as it is read, in
 * order: `--- Page N ---` and what the page holds.
 */
export async function readPdf(
  source: PdfSource,
  filename: string,
  options: PdfExtractionOptions,
  onPage: (text: string) => Promise<void>,
): Promise<PdfFacts> {
  const visionClient = options.visionClient ?? null;
  const processImages = options.processImages ?? true;
  const maxPages = options.maxPages ?? PDF_MAX_PAGES;
  const onProgress = options.onProgress;
  const readsImages = processImages && visionClient !== null;

  const pdfjs = await loadPdfjs();
  let pdf = await openPdf(pdfjs, source, options.maxImagePixels);
  const reopenAfter = options.reopenAfterBytes ?? REOPEN_AFTER_BYTES;
  try {
    const totalPages = pdf.doc.numPages;
    const pagesToProcess = Math.min(totalPages, maxPages);
    if (totalPages > maxPages) {
      console.warn(
        `PDF has ${totalPages} pages, exceeding limit of ${maxPages}. ` +
          `Only the first ${maxPages} pages will be processed.`,
      );
    }

    let visionUsed = false;
    let scannedPagesDetected = 0;
    let ocrApplied = false;
    let pagesDone = 0;

    // What the document had loaded when it was back at the page it was
    // opened again for. Finding a page costs a fresh document whatever lies
    // on the way to it: in a PDF whose pages hang off one long list, every
    // page before it. Counted against the budget, that alone was over it,
    // and the document was opened again for every page: a file of 42 MB
    // was read 23 GB deep. So only what is loaded past that point counts,
    // and the document is not opened again before that is as much as it
    // cost to get back: all the openings together then read the file a few
    // times over at most, however it is laid out.
    let reached = 0;
    for (let pageNum = 0; pageNum < pagesToProcess; pageNum += 1) {
      let page: PDFPageProxy;
      if (pdf.loaded() - reached > Math.max(reopenAfter, reached)) {
        await pdf.close();
        collectGarbage();
        pdf = await openPdf(pdfjs, source, options.maxImagePixels);
        page = await pdf.whileReadable(pdf.doc.getPage(pageNum + 1));
        reached = pdf.loaded();
      } else {
        page = await pdf.whileReadable(pdf.doc.getPage(pageNum + 1));
      }
      const readable = pdf;
      try {
        const text = await readable.whileReadable(pageText(page));
        const parts: string[] = text ? [text] : [];
        const lowText = text.length < SCANNED_PAGE_TEXT_THRESHOLD;

        // Only a page with almost no text can be a scan, and only a vision
        // client reads images: every other page is spared its images.
        const { images, largeLeftOut } =
          lowText || readsImages
            ? await pageImages(
                page,
                pdfjs.OPS,
                options.maxImagePixels !== undefined,
                readable.whileReadable,
              )
            : { images: [], largeLeftOut: false };

        const hasLargeImage =
          largeLeftOut ||
          images.some((img) => img.areaRatio > LARGE_IMAGE_RATIO);
        const isScannedPage = lowText && hasLargeImage;
        if (isScannedPage) {
          scannedPagesDetected += 1;
        }

        let pageVisionUsed = false;
        if (processImages && visionClient && images.length > 0) {
          for (const img of images) {
            const imageBytes = await readable.whileReadable(
              imageBytesFromPage(page, img.name),
            );
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
                const description =
                  await visionClient.describeImage(imageBytes);
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

        await onPage(`--- Page ${pageNum + 1} ---\n${parts.join('\n\n')}`);
      } finally {
        page.cleanup();
        pagesDone += 1;
        onProgress?.(pagesDone, pagesToProcess);
      }
    }

    if (scannedPagesDetected > 0 && !visionClient) {
      console.warn(
        `PDF '${filename}': ${scannedPagesDetected} scanned page(s) detected ` +
          `but no vision client configured — text may be incomplete`,
      );
    }

    return {
      visionUsed,
      scannedPagesDetected,
      ocrApplied,
      pageCount: totalPages,
    };
  } finally {
    await pdf.close();
  }
}

/** Extract text from PDF bytes. */
export async function extractTextFromPdfBytes(
  pdfBytes: Uint8Array,
  filename = 'document.pdf',
  options: PdfExtractionOptions = {},
): Promise<PdfExtractionResult> {
  const pages: string[] = [];
  const facts = await readPdf(
    { kind: 'bytes', bytes: pdfBytes },
    filename,
    options,
    (text) => {
      pages.push(text);
      return Promise.resolve();
    },
  );
  return { text: pages.join('\n\n'), ...facts };
}
