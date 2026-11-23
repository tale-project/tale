import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  chunkDocument,
  type ContextualChunk,
} from '../../../lib/knowledge/chunking.ts';
import type { PreparedChunk } from '../../core/knowledge/prepare.ts';
import { chunksFromSpool, writeChunkSpool } from './chunk-spool.ts';

let dir: string;
let serial = 0;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'chunk-spool-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function paths(): [string, string] {
  serial += 1;
  return [
    path.join(dir, `chunks-${serial}.jsonl`),
    path.join(dir, `chunks-${serial}.idx`),
  ];
}

/** The chunks as they are handed to the writer, some marked as repeats. */
function records(
  chunks: readonly ContextualChunk[],
  repeats: ReadonlySet<number> = new Set(),
): PreparedChunk[] {
  return chunks.map((chunk) => ({ chunk, repeat: repeats.has(chunk.index) }));
}

/** Paragraphs that make many chunks, with text JSON has to escape and
 * characters of every width. */
const TEXT = Array.from(
  { length: 400 },
  (_line, at) =>
    `Paragraph ${at}: "quoted", a tab\tand a back\\slash; Zürich, 東京, 😀. ${'word '.repeat(60)}`,
).join('\n\n');

describe("a prepared document's chunks, in a file", () => {
  it('hands back every chunk as it was written, by any window', async () => {
    const chunks = chunkDocument(TEXT, { title: 'A report' });
    expect(chunks.length).toBeGreaterThan(50);
    const repeats = new Set([3, 17, chunks.length - 1]);
    const [chunksPath, indexPath] = paths();
    await expect(
      writeChunkSpool(chunksPath, indexPath, records(chunks, repeats)),
    ).resolves.toBe(chunks.length);

    const spool = chunksFromSpool(chunksPath, indexPath, chunks.length);
    try {
      expect(spool.total).toBe(chunks.length);
      const whole = await spool.window(0, chunks.length);
      expect(whole.map(({ chunk }) => chunk)).toEqual(chunks);
      expect(
        whole.filter(({ repeat }) => repeat).map(({ chunk }) => chunk.index),
      ).toEqual([3, 17, chunks.length - 1]);

      // The slices indexing asks for, and one asked for again.
      expect((await spool.window(0, 64)).map(({ chunk }) => chunk)).toEqual(
        chunks.slice(0, 64),
      );
      expect((await spool.window(64, 70)).map(({ chunk }) => chunk)).toEqual(
        chunks.slice(64, 70),
      );
      expect((await spool.window(17, 18))[0]).toEqual({
        chunk: chunks[17],
        repeat: true,
      });
    } finally {
      await spool.close();
    }
  });

  it('answers what there is of a window that runs past the end, and nothing for an empty one', async () => {
    const chunks = chunkDocument(TEXT);
    const [chunksPath, indexPath] = paths();
    await writeChunkSpool(chunksPath, indexPath, records(chunks));
    const spool = chunksFromSpool(chunksPath, indexPath, chunks.length);
    try {
      const tail = await spool.window(chunks.length - 2, chunks.length + 50);
      expect(tail.map(({ chunk }) => chunk)).toEqual(chunks.slice(-2));
      expect(await spool.window(5, 5)).toEqual([]);
      expect(await spool.window(9, 4)).toEqual([]);
      expect(await spool.window(chunks.length, chunks.length + 1)).toEqual([]);
    } finally {
      await spool.close();
    }
  });

  it('writes a document of no chunks, and reads none', async () => {
    const [chunksPath, indexPath] = paths();
    await expect(writeChunkSpool(chunksPath, indexPath, [])).resolves.toBe(0);
    expect(readFileSync(chunksPath)).toHaveLength(0);
    const spool = chunksFromSpool(chunksPath, indexPath, 0);
    expect(await spool.window(0, 64)).toEqual([]);
    await spool.close();
  });

  it('never writes over files that are already there', async () => {
    const [chunksPath, indexPath] = paths();
    writeFileSync(chunksPath, 'somebody else');
    await expect(
      writeChunkSpool(chunksPath, indexPath, records(chunkDocument(TEXT))),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(readFileSync(chunksPath, 'utf8')).toBe('somebody else');
  });

  it('refuses a spool that is cut short, where it would read past its end', async () => {
    const chunks = chunkDocument(TEXT);
    const [chunksPath, indexPath] = paths();
    await writeChunkSpool(chunksPath, indexPath, records(chunks));
    const cut = readFileSync(chunksPath).subarray(0, 5000);
    writeFileSync(chunksPath, cut);
    const spool = chunksFromSpool(chunksPath, indexPath, chunks.length);
    try {
      await expect(spool.window(0, chunks.length)).rejects.toThrow(
        'the chunk spool is cut short (its chunks)',
      );
    } finally {
      await spool.close();
    }
  });

  it('refuses a spool whose index points at another chunk', async () => {
    const chunks = chunkDocument(TEXT);
    const [chunksPath, indexPath] = paths();
    await writeChunkSpool(chunksPath, indexPath, records(chunks));
    // The index of a spool of fewer chunks: every window lands one chunk on.
    const index = readFileSync(indexPath);
    writeFileSync(indexPath, index.subarray(8));
    const spool = chunksFromSpool(chunksPath, indexPath, chunks.length - 1);
    try {
      await expect(spool.window(0, 4)).rejects.toThrow(
        'the chunk spool does not hold chunk 0 where its index says',
      );
    } finally {
      await spool.close();
    }
  });

  it('can be closed before it was read, and twice', async () => {
    const [chunksPath, indexPath] = paths();
    await writeChunkSpool(chunksPath, indexPath, records(chunkDocument(TEXT)));
    const spool = chunksFromSpool(chunksPath, indexPath, 3);
    await spool.close();
    await spool.window(0, 1);
    await spool.close();
    await spool.close();
  });

  // The writer is handed the chunks as they are cut: it must take the next
  // only once it has gathered the one before, or it would hold them all.
  it('takes each chunk when the one before it is gathered, and writes a megabyte at a time', async () => {
    const chunks = chunkDocument(TEXT.repeat(8), { title: 'A report' });
    const taken: number[] = [];
    let handed = 0;
    function* asCut(): Generator<PreparedChunk> {
      for (const chunk of chunks) {
        handed += 1;
        yield { chunk, repeat: false };
        taken.push(handed);
      }
    }
    const [chunksPath, indexPath] = paths();
    const total = await writeChunkSpool(chunksPath, indexPath, asCut());
    expect(total).toBe(chunks.length);
    // Never a chunk handed over ahead of the one being gathered.
    expect(taken).toEqual(chunks.map((_chunk, at) => at + 1));
    const spool = chunksFromSpool(chunksPath, indexPath, total);
    try {
      expect((await spool.window(0, total)).map(({ chunk }) => chunk)).toEqual(
        chunks,
      );
    } finally {
      await spool.close();
    }
  });

  it('refuses a chunk that is not the next in order, where a reader would find another', async () => {
    const chunks = chunkDocument(TEXT);
    const [chunksPath, indexPath] = paths();
    const outOfOrder = records(chunks).toSpliced(2, 1);
    await expect(
      writeChunkSpool(chunksPath, indexPath, outOfOrder),
    ).rejects.toThrow('chunk 3 was handed over where chunk 2 is due');
  });
});
