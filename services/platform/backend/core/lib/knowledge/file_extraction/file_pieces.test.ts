import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PIECE_BYTES, piecesOfFile } from './file_pieces';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'file-pieces-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function onDisk(name: string, bytes: Uint8Array): string {
  const file = path.join(dir, name);
  writeFileSync(file, bytes);
  return file;
}

/** Bytes that differ from place to place, so a piece out of place shows. */
function patterned(length: number): Buffer {
  const bytes = Buffer.alloc(length);
  for (let at = 0; at < length; at += 1)
    bytes[at] = (at * 31 + (at >> 8)) & 0xff;
  return bytes;
}

describe('a file read a piece at a time', () => {
  it.each([
    ['nothing', 0],
    ['one byte', 1],
    ['a byte less than a piece', PIECE_BYTES - 1],
    ['exactly a piece', PIECE_BYTES],
    ['a byte more than a piece', PIECE_BYTES + 1],
    ['many pieces and a rest', 5 * PIECE_BYTES + 123],
  ])(
    'hands on every byte of a file that holds %s, in order',
    async (_what, length) => {
      const bytes = patterned(length);
      const file = onDisk(`whole-${length}.bin`, bytes);
      const read: Buffer[] = [];
      for await (const piece of piecesOfFile(file)) {
        expect(piece.length).toBeGreaterThan(0);
        expect(piece.length).toBeLessThanOrEqual(PIECE_BYTES);
        // A piece is good until the next is asked for: what is kept of it is
        // a copy.
        read.push(Buffer.from(piece));
      }
      expect(Buffer.concat(read).equals(bytes)).toBe(true);
    },
  );

  it('reads through one buffer, however long the file', async () => {
    const file = onDisk('long.bin', patterned(40 * 1024));
    const buffers = new Set<ArrayBufferLike>();
    let pieces = 0;
    for await (const piece of piecesOfFile(file, 1024)) {
      buffers.add(piece.buffer);
      pieces += 1;
    }
    expect(pieces).toBe(40);
    expect(buffers.size).toBe(1);
  });

  it('lets go of the file when its reader stops early, or the file is not there', async () => {
    const file = onDisk('early.bin', patterned(10 * 1024));
    for await (const piece of piecesOfFile(file, 1024)) {
      expect(piece.length).toBe(1024);
      break;
    }
    // Closed: the file can be removed and its directory with it.
    rmSync(file);
    await expect(
      (async () => {
        for await (const _piece of piecesOfFile(file)) {
          // Never reached: the file is gone.
        }
      })(),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
