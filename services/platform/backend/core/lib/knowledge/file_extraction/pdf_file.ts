'use node';

/**
 * A PDF read from a file on disk, by the ranges its pages need.
 */

import { open } from 'node:fs/promises';

import {
  readPdf,
  type PdfExtractionOptions,
  type PdfFacts,
} from '../extraction/pdf';
import type { TextSink } from './text_sink';

/**
 * Write the text of the PDF at `path` to `sink`: the text
 * `extractTextFromPdfBytes` returns for the same file, a page at a time,
 * with the file read by ranges and never held whole.
 */
export async function extractTextFromPdfFile(
  path: string,
  sink: TextSink,
  filename = 'document.pdf',
  options: PdfExtractionOptions = {},
): Promise<PdfFacts> {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    let first = true;
    return await readPdf(
      {
        kind: 'ranges',
        size,
        read: async (begin, end) => {
          const chunk = new Uint8Array(end - begin);
          const { bytesRead } = await file.read(chunk, 0, chunk.length, begin);
          return chunk.subarray(0, bytesRead);
        },
      },
      filename,
      options,
      async (text) => {
        await sink.write(first ? text : `\n\n${text}`);
        first = false;
      },
    );
  } finally {
    await file.close();
  }
}
