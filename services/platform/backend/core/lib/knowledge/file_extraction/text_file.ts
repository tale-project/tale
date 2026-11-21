'use node';

/**
 * A text file read a piece at a time.
 */

import { ExtractionError } from '../extraction/errors';
import { piecesOfFile } from './file_pieces';
import type { TextSink } from './text_sink';

/**
 * Write the text of the file at `path` to `sink`: the text
 * `extractTextFromTextBytes` returns for the same file. A file that turns
 * out not to be UTF-8 part-way through is started over, as that function
 * decides it: refused when it carries a NUL, read as Latin-1 otherwise.
 */
export async function extractTextFromTextFile(
  path: string,
  sink: TextSink,
  filename = 'document.txt',
): Promise<void> {
  const strict = new TextDecoder('utf-8', { fatal: true });
  let utf8 = true;
  for await (const piece of piecesOfFile(path)) {
    let text: string;
    try {
      text = strict.decode(piece, { stream: true });
    } catch {
      // The decoder's only complaint: bytes that are not UTF-8.
      utf8 = false;
      break;
    }
    await sink.write(text);
  }
  if (utf8) {
    try {
      // A sequence cut off by the end of the file is not UTF-8 either.
      await sink.write(strict.decode());
      return;
    } catch {
      utf8 = false;
    }
  }

  await sink.reset();
  for await (const piece of piecesOfFile(path)) {
    if (piece.includes(0)) {
      throw new ExtractionError(
        'not_text',
        `"${filename}" is not readable text — it carries binary data; re-export it as UTF-8 text.`,
      );
    }
  }
  console.warn(`File ${filename} is not UTF-8, fell back to Latin-1`);
  for await (const piece of piecesOfFile(path)) {
    await sink.write(piece.toString('latin1'));
  }
}
