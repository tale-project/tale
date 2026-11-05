import type { Sql } from 'postgres';

import type { ExtractedDocument } from '../../core/lib/knowledge/extraction/router.ts';

/**
 * Persist what extraction learned about the file: how many pages it has, how
 * many of them are scans, and whether OCR actually ran on them. Only the PDF
 * leg answers these today, so a format that reports nothing leaves the
 * columns as they are rather than stamping a zero that reads like a measured
 * one. `vision_required` is the operator's version of the same finding: the
 * file holds pages no text extractor can read.
 */
export async function stampExtractionMetadata(
  sql: Sql,
  fileId: string,
  extracted: ExtractedDocument,
): Promise<void> {
  if (
    extracted.pageCount === undefined &&
    extracted.scannedPagesDetected === undefined
  ) {
    return;
  }
  const scanned = extracted.scannedPagesDetected;
  await sql`
    UPDATE app.file_metadata SET
      page_count = coalesce(${extracted.pageCount ?? null}, page_count),
      scanned_pages_detected = coalesce(${scanned ?? null}, scanned_pages_detected),
      ocr_applied = coalesce(${extracted.ocrApplied ?? null}, ocr_applied),
      vision_required = coalesce(
        ${scanned !== undefined ? scanned > 0 : null}, vision_required)
    WHERE id = ${fileId}
  `;
}
