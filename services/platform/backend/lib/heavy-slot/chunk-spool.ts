/**
 * A prepared document's chunks, in a file.
 *
 * The heavy slot's child cuts a document into chunks and writes them here;
 * the process that indexes the document reads them back a slice at a time,
 * as it embeds and stores them. It never holds the document: a spreadsheet
 * of four thousand chunks is sixty-four of them in memory at once
 * (tale-project/tale#4942).
 *
 * Two files. The chunks file holds one JSON line per chunk. The index file
 * holds where each line starts, and where the last one ends: `total + 1`
 * positions, eight bytes each, so any slice is read with two short reads
 * and no scan.
 *
 * The chunks are written as they are handed over, so the writer holds a
 * megabyte of them at most, however many there are.
 */

import { open, type FileHandle } from 'node:fs/promises';

import type {
  PreparedChunk,
  PreparedChunks,
} from '../../core/knowledge/prepare.ts';

const POSITION_BYTES = 8;
/** How much is gathered before it is written. */
const WRITE_BYTES = 1024 * 1024;

/**
 * Write `chunks` to the two files, which must not exist, taking each chunk
 * when the one before it is gathered. Answers how many there were. A chunk
 * that is not the next in order is refused: a reader finds a chunk by its
 * place.
 */
export async function writeChunkSpool(
  chunksPath: string,
  indexPath: string,
  chunks: Iterable<PreparedChunk>,
): Promise<number> {
  const positions: number[] = [];
  const file = await open(chunksPath, 'wx', 0o600);
  let position = 0;
  try {
    // One buffer, filled and written and filled again: a buffer for every
    // line would be several times the document, waiting to be collected.
    const gathered = Buffer.allocUnsafe(WRITE_BYTES);
    let filled = 0;
    for (const record of chunks) {
      if (record.chunk.index !== positions.length) {
        throw new Error(
          `chunk ${record.chunk.index} was handed over where chunk ${positions.length} is due`,
        );
      }
      const line = `${JSON.stringify(record)}\n`;
      const bytes = Buffer.byteLength(line, 'utf8');
      positions.push(position);
      position += bytes;
      if (filled + bytes > gathered.length) {
        await file.writeFile(gathered.subarray(0, filled));
        filled = 0;
      }
      if (bytes > gathered.length) {
        // A line longer than the buffer goes out on its own.
        await file.writeFile(line, 'utf8');
      } else {
        filled += gathered.write(line, filled, 'utf8');
      }
    }
    if (filled > 0) await file.writeFile(gathered.subarray(0, filled));
  } finally {
    await file.close();
  }
  const total = positions.length;
  const index = await open(indexPath, 'wx', 0o600);
  try {
    const where = Buffer.alloc((total + 1) * POSITION_BYTES);
    for (const [at, start] of positions.entries()) {
      where.writeDoubleLE(start, at * POSITION_BYTES);
    }
    where.writeDoubleLE(position, total * POSITION_BYTES);
    await index.writeFile(where);
  } finally {
    await index.close();
  }
  return total;
}

function isPreparedChunk(value: unknown): value is PreparedChunk {
  if (value === null || typeof value !== 'object') return false;
  if (!('chunk' in value) || !('repeat' in value)) return false;
  const { chunk, repeat } = value;
  return (
    typeof repeat === 'boolean' &&
    chunk !== null &&
    typeof chunk === 'object' &&
    'index' in chunk &&
    typeof chunk.index === 'number' &&
    'text' in chunk &&
    typeof chunk.text === 'string' &&
    'embedText' in chunk &&
    typeof chunk.embedText === 'string'
  );
}

async function readExactly(
  file: FileHandle,
  length: number,
  position: number,
  what: string,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, position);
  if (bytesRead !== length) {
    throw new Error(`the chunk spool is cut short (${what})`);
  }
  return buffer;
}

/**
 * The chunks of a spool of `total`, read a window at a time. `close` lets
 * go of the two files; the caller removes them.
 */
export function chunksFromSpool(
  chunksPath: string,
  indexPath: string,
  total: number,
): PreparedChunks & { close(): Promise<void> } {
  let files: Promise<{ chunks: FileHandle; index: FileHandle }> | null = null;
  const opened = (): Promise<{ chunks: FileHandle; index: FileHandle }> =>
    (files ??= (async () => {
      const chunks = await open(chunksPath, 'r');
      try {
        return { chunks, index: await open(indexPath, 'r') };
      } catch (error) {
        await chunks.close();
        throw error;
      }
    })());

  return {
    total,
    async window(from, to) {
      const first = Math.max(0, from);
      const last = Math.min(total, to);
      if (last <= first) return [];
      const { chunks, index } = await opened();
      const positions = await readExactly(
        index,
        (last - first + 1) * POSITION_BYTES,
        first * POSITION_BYTES,
        'its index',
      );
      const start = positions.readDoubleLE(0);
      const end = positions.readDoubleLE((last - first) * POSITION_BYTES);
      const lines = await readExactly(chunks, end - start, start, 'its chunks');
      const out: PreparedChunk[] = [];
      for (let at = 0; at < last - first; at += 1) {
        const lineStart = positions.readDoubleLE(at * POSITION_BYTES) - start;
        const lineEnd =
          positions.readDoubleLE((at + 1) * POSITION_BYTES) - start;
        const record: unknown = JSON.parse(
          lines.toString('utf8', lineStart, lineEnd),
        );
        if (!isPreparedChunk(record) || record.chunk.index !== first + at) {
          throw new Error(
            `the chunk spool does not hold chunk ${first + at} where its index says`,
          );
        }
        out.push(record);
      }
      return out;
    },
    async close() {
      if (files === null) return;
      const held = files;
      files = null;
      let handles: { chunks: FileHandle; index: FileHandle };
      try {
        handles = await held;
      } catch (error) {
        // The files never opened, which whoever asked for a window was
        // told: there is nothing here to close.
        console.warn(
          `[heavy-slot] a chunk spool that could not be opened has nothing to close: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      await Promise.all([handles.chunks.close(), handles.index.close()]);
    },
  };
}
