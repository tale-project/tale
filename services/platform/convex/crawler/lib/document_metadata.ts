'use node';

/**
 * In-process document metadata extraction (page count, scanned-page detection,
 * title/author, created/modified dates) for PDF / DOCX / PPTX.
 *
 * Ports the crawler `extract-metadata` endpoints:
 *   - PDF: `services/crawler/app/routers/pdf.py::extract_pdf_metadata` (PyMuPDF
 *     `doc.metadata` + per-page large-image scan). We use `pdfjs-dist` (the same
 *     library the platform's in-process RAG PDF extractor uses) and the same
 *     `LARGE_IMAGE_RATIO` heuristic from `convex/lib/knowledge/extraction/pdf.ts`.
 *   - DOCX/PPTX: `file_parser_service.py::_extract_ooxml_metadata` read the
 *     OOXML core properties (`docProps/core.xml`). We parse that part with
 *     `fast-xml-parser` (the platform's OOXML reader of choice).
 *
 * Returns Unix-ms timestamps to match the crawler contract consumed by
 * `convex/file_metadata/internal_actions.ts` (`created_at` / `modified_at` /
 * `page_count` / `scanned_pages_detected`).
 *
 * // TODO(verify): PyMuPDF surfaced `creationDate`/`modDate` in the raw PDF
 * `D:YYYYMMDD...` string form; pdfjs `getMetadata()` returns those same raw
 * strings under `info.CreationDate`/`info.ModDate`, so `parsePdfDate` reuses the
 * crawler's exact regex + year-range guard. The scanned-page heuristic depends
 * on pdfjs surfacing image XObjects via the operator list with their placement
 * transform — identical to the in-process RAG extractor — but the absolute
 * pixel ratio for a given scanned PDF cannot be byte-compared to PyMuPDF's
 * `get_image_bbox` without a live fixture; flag if counts diverge.
 */

import { XMLParser } from 'fast-xml-parser';
import type { PDFPageProxy } from 'pdfjs-dist/build/pdf.mjs';

import { GuardedZip } from '../../lib/knowledge/extraction/ooxml';
// pdfjs must be loaded through the shared loader so its DOM polyfills + fake
// worker are installed before the first import; a bare `import('pdfjs-dist/…')`
// here would poison the process-wide module cache with `DOMMatrix is not
// defined` (see pdfjs_loader.ts).
import { loadPdfjs } from '../../lib/knowledge/extraction/pdfjs_loader';

const MIN_YEAR = 1970;
const MAX_YEAR = 2100;
const LARGE_IMAGE_RATIO = 0.5;
const MIN_IMAGE_AREA = 10_000;

export interface DocumentMetadataResult {
  title: string | null;
  author: string | null;
  pageCount: number | null;
  createdAt: number | null;
  modifiedAt: number | null;
  scannedPagesDetected: number;
}

const PDF_DATE_RE =
  /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-])?(\d{2})?'?(\d{2})?'?/;

/** Parse a PDF `D:YYYYMMDDHHmmSSOHH'mm'` date into Unix ms. Mirrors `_parse_pdf_date`. */
export function parsePdfDate(
  dateStr: string | null | undefined,
): number | null {
  if (typeof dateStr !== 'string') {
    return null;
  }
  const trimmed = dateStr.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const match = PDF_DATE_RE.exec(trimmed);
  if (!match) {
    console.warn(`[document_metadata] failed to parse PDF date: '${trimmed}'`);
    return null;
  }
  const year = Number(match[1]);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    console.warn(`[document_metadata] PDF date year out of range (${year})`);
    return null;
  }
  const month = Number(match[2] ?? '01');
  const day = Number(match[3] ?? '01');
  const hour = Number(match[4] ?? '00');
  const minute = Number(match[5] ?? '00');
  const second = Number(match[6] ?? '00');

  const tzSign = match[7];
  const tzHours = Number(match[8] ?? '0');
  const tzMinutes = Number(match[9] ?? '0');

  // Compute the epoch ms by treating the local fields as UTC, then subtract the
  // declared zone offset (mirrors Python's timezone-aware datetime → timestamp).
  let offsetMinutes = 0;
  if (tzSign === '+') {
    offsetMinutes = tzHours * 60 + tzMinutes;
  } else if (tzSign === '-') {
    offsetMinutes = -(tzHours * 60 + tzMinutes);
  }
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(utcMs)) {
    return null;
  }
  return utcMs - offsetMinutes * 60_000;
}

/** Parse an ISO 8601 / OOXML core-property date into Unix ms with range guard. */
function parseIsoDate(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    return null;
  }
  const year = new Date(ms).getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) {
    console.warn(`[document_metadata] OOXML date year out of range (${year})`);
    return null;
  }
  return ms;
}

const coreParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
});

/** Read a string field from a parsed core-properties node. */
function coreString(node: unknown, key: string): string | null {
  if (node === null || typeof node !== 'object') {
    return null;
  }
  const value = Reflect.get(node, key);
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : null;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return null;
}

/** Extract OOXML (DOCX/PPTX) core-property metadata. Mirrors `_extract_ooxml_metadata`. */
export async function extractOoxmlMetadata(
  bytes: Uint8Array,
): Promise<DocumentMetadataResult> {
  const result: DocumentMetadataResult = {
    title: null,
    author: null,
    pageCount: null,
    createdAt: null,
    modifiedAt: null,
    scannedPagesDetected: 0,
  };

  try {
    const zip = await GuardedZip.load(bytes);
    const coreXml = await zip.readString('docProps/core.xml');
    if (!coreXml) {
      return result;
    }
    const parsed: unknown = coreParser.parse(coreXml);
    const root =
      parsed !== null && typeof parsed === 'object'
        ? Reflect.get(parsed, 'coreProperties')
        : null;
    if (root === null || typeof root !== 'object') {
      return result;
    }
    result.title = coreString(root, 'title');
    // dc:creator → author (matches python-docx core_properties.author).
    result.author = coreString(root, 'creator');
    result.createdAt = parseIsoDate(coreString(root, 'created'));
    result.modifiedAt = parseIsoDate(coreString(root, 'modified'));
  } catch (err) {
    console.warn(
      `[document_metadata] failed to extract OOXML metadata: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return result;
}

interface Transform {
  a: number;
  d: number;
}

/** Find the most recent `transform` op before index `i`. Mirrors RAG pdf.ts. */
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

/** Count whether a page has a large image (> {@link LARGE_IMAGE_RATIO} of area). */
async function pageHasLargeImage(page: PDFPageProxy): Promise<boolean> {
  const { OPS } = await loadPdfjs();
  const viewport = page.getViewport({ scale: 1 });
  const pageArea = viewport.width * viewport.height;
  if (pageArea <= 0) {
    return false;
  }
  try {
    const opList = await page.getOperatorList();
    for (let i = 0; i < opList.fnArray.length; i += 1) {
      const fn = opList.fnArray[i];
      if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
        const transformOp = findPrecedingTransform(opList, i, OPS.transform);
        const drawnArea = Math.abs(transformOp.a * transformOp.d);
        if (
          drawnArea >= MIN_IMAGE_AREA &&
          drawnArea / pageArea > LARGE_IMAGE_RATIO
        ) {
          return true;
        }
      }
    }
  } catch (err) {
    console.warn(
      `[document_metadata] failed to read PDF operator list: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return false;
}

/** Extract PDF metadata. Mirrors `extract_pdf_metadata` (PyMuPDF → pdfjs). */
export async function extractPdfMetadata(
  bytes: Uint8Array,
): Promise<DocumentMetadataResult> {
  const result: DocumentMetadataResult = {
    title: null,
    author: null,
    pageCount: null,
    createdAt: null,
    modifiedAt: null,
    scannedPagesDetected: 0,
  };

  const { getDocument } = await loadPdfjs();
  const doc = await getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  try {
    result.pageCount = doc.numPages;

    const meta = await doc.getMetadata();
    const info = meta.info;
    if (info !== null && typeof info === 'object') {
      const title = Reflect.get(info, 'Title');
      const author = Reflect.get(info, 'Author');
      const creationDate = Reflect.get(info, 'CreationDate');
      const modDate = Reflect.get(info, 'ModDate');
      result.title =
        typeof title === 'string' && title.length > 0 ? title : null;
      result.author =
        typeof author === 'string' && author.length > 0 ? author : null;
      result.createdAt = parsePdfDate(
        typeof creationDate === 'string' ? creationDate : null,
      );
      result.modifiedAt = parsePdfDate(
        typeof modDate === 'string' ? modDate : null,
      );
    }

    let scanned = 0;
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
      const page = await doc.getPage(pageNum);
      try {
        if (await pageHasLargeImage(page)) {
          scanned += 1;
        }
      } finally {
        page.cleanup();
      }
    }
    result.scannedPagesDetected = scanned;
  } finally {
    await doc.destroy();
  }

  return result;
}

/** Dispatch metadata extraction by file extension (`pdf` | `docx` | `pptx`). */
export async function extractDocumentMetadata(
  bytes: Uint8Array,
  ext: string,
): Promise<DocumentMetadataResult> {
  if (ext === 'pdf') {
    return extractPdfMetadata(bytes);
  }
  if (ext === 'docx' || ext === 'pptx') {
    return extractOoxmlMetadata(bytes);
  }
  return {
    title: null,
    author: null,
    pageCount: null,
    createdAt: null,
    modifiedAt: null,
    scannedPagesDetected: 0,
  };
}
