'use node';

/**
 * A file read a piece at a time, through one buffer, or only as far as its
 * first bytes.
 */

import { open } from 'node:fs/promises';

/**
 * How much of a file is read at a time. A piece decodes to a string that is
 * small enough to be collected with the young: a megabyte at a time, every
 * piece and every string made of one was garbage that waited for a full
 * collection, and a text file was held three times over while it was read
 * (tale-project/tale#4942).
 */
export const PIECE_BYTES = 32 * 1024;

/**
 * The bytes of the file at `path`, in order, a piece at a time.
 *
 * Every piece is a view of the same buffer: it holds the file's next bytes
 * only until the piece after it is asked for, so a reader takes what it
 * needs of a piece before it goes on.
 */
export async function* piecesOfFile(
  path: string,
  pieceBytes = PIECE_BYTES,
): AsyncGenerator<Buffer, void, undefined> {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(pieceBytes);
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, pieceBytes, null);
      if (bytesRead === 0) return;
      yield buffer.subarray(0, bytesRead);
    }
  } finally {
    await file.close();
  }
}

/**
 * The first bytes of the file at `path`, at most `bytes` of them: what tells
 * one kind of file from another, without the file being read.
 */
export async function headOfFile(path: string, bytes: number): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(bytes);
    let filled = 0;
    while (filled < bytes) {
      const { bytesRead } = await file.read(
        buffer,
        filled,
        bytes - filled,
        filled,
      );
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return buffer.subarray(0, filled);
  } finally {
    await file.close();
  }
}
