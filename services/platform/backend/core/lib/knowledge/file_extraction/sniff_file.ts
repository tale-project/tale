'use node';

import { openAsBlob } from 'node:fs';

import { fileTypeFromBlob, type FileTypeResult } from 'file-type';

import { documentExtensionFromFileType } from '../../../../../lib/knowledge/crawl-parse';

/**
 * What `file-type` makes of a file: what `fileTypeFromBuffer` answers for the
 * same bytes, read from the disk as far as the answer needs and never held
 * whole.
 *
 * The file is read as a blob, and not with the library's `fileTypeFromFile`:
 * that one loads its file reader (`strtok3`) at the call, by a name it keeps
 * from bundlers on purpose. The image is a bundle with no `node_modules`
 * beside it, so there the load failed, for every file and nowhere else
 * (`image-check.ts` now asks). A blob goes through the reader the bundle
 * already holds.
 */
export async function fileTypeOfFile(
  path: string,
): Promise<FileTypeResult | undefined> {
  return await fileTypeFromBlob(await openAsBlob(path));
}

/**
 * The document format a file is, from the file: what `sniffDocumentExtension`
 * answers for the same bytes. `null` when it is none the extraction router
 * reads, or when it cannot be read at all.
 */
export async function sniffDocumentFile(path: string): Promise<string | null> {
  let detected: FileTypeResult | undefined;
  try {
    detected = await fileTypeOfFile(path);
  } catch (error) {
    console.warn(
      '[sniff] document sniff failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
  return documentExtensionFromFileType(detected?.ext);
}
