'use node';

import { fileTypeFromBuffer } from 'file-type';

import { documentExtensionFromFileType } from '../../../../../lib/knowledge/crawl-parse';

/**
 * Which document the bytes are, for a download whose declared type said
 * nothing or the wrong thing (`application/octet-stream`; a TYPO3 export's
 * `application/vnd.ms-excel` on an `.xlsx`, 2026-09-30): the extraction
 * router's extension when `file-type` recognises one of the five documents
 * it reads, else `null`. A detector failure is no document either.
 */
export async function sniffDocumentExtension(
  bytes: Uint8Array,
): Promise<string | null> {
  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try {
    detected = await fileTypeFromBuffer(bytes);
  } catch (error) {
    console.warn(
      '[crawl] document sniff failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
  return documentExtensionFromFileType(detected?.ext);
}
