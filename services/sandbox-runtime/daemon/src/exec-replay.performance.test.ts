import { expect, spyOn, test } from 'bun:test';
import { fstatSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { ExecReplay, ReplayBudget } from './exec-replay.ts';

function createReplay(
  limits?: ConstructorParameters<typeof ExecReplay>[0],
  budget?: ReplayBudget,
) {
  return new ExecReplay(limits, budget, tmpdir());
}

function output(seq: number, bytes = 384): string {
  return `${JSON.stringify({ t: 'stdout', seq, b64: Buffer.alloc(bytes, seq % 256).toString('base64') })}\n`;
}

function isFileHandle(value: unknown): value is FileHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fd' in value &&
    typeof value.fd === 'number' &&
    'read' in value &&
    typeof value.read === 'function' &&
    'writev' in value &&
    typeof value.writev === 'function'
  );
}

function writerFor(replay: ExecReplay): FileHandle {
  const file: unknown = Reflect.get(replay, 'writer');
  if (!isFileHandle(file)) throw new Error('missing replay writer');
  return file;
}

async function rejectsWith(
  work: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await work;
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error('expected replay failure');
}

async function appendAll(
  replay: ExecReplay,
  lines: string[],
  first = 1,
): Promise<void> {
  let bytes = 0;
  let pending: Promise<void>[] = [];
  for (const [index, line] of lines.entries()) {
    bytes += Buffer.byteLength(line);
    pending.push(replay.append(line, first + index));
    if (bytes >= 128 * 1024) {
      await Promise.all(pending);
      pending = [];
      bytes = 0;
    }
  }
  await Promise.all(pending);
}

async function collect(
  replay: ExecReplay,
  since: number,
  until: number,
): Promise<string[]> {
  const result: string[] = [];
  await replay.replay(
    since,
    until,
    async (line) => {
      result.push(line);
    },
    () => {
      throw new Error('unexpected replay gap');
    },
  );
  return result;
}

test('replay batches bounded vectors and preserves records across partial writes', async () => {
  const replay = createReplay();
  try {
    await replay.append(output(1), 1);
    const file = writerFor(replay);
    const original = file.writev.bind(file);
    const requests: { vectors: number; bytes: number }[] = [];
    file.writev = async (buffers, position) => {
      requests.push({
        vectors: buffers.length,
        bytes: buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0),
      });
      if (requests.length === 1) {
        const first = buffers[0];
        if (!first) throw new Error('empty write batch');
        const prefix = Buffer.concat(
          buffers.map((buffer) =>
            Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength),
          ),
        ).subarray(0, first.byteLength + 7);
        const result = await original([prefix], position);
        return { bytesWritten: result.bytesWritten, buffers };
      }
      return original(buffers, position);
    };
    const lines = Array.from({ length: 300 }, (_, index) =>
      output(index + 2, 1024),
    );
    await appendAll(replay, lines, 2);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.length).toBeLessThan(15);
    expect(
      requests.every(
        (request) => request.vectors <= 64 && request.bytes <= 128 * 1024,
      ),
    ).toBe(true);
    expect(requests.some((request) => request.vectors > 1)).toBe(true);
    expect(await collect(replay, 1, 301)).toEqual(
      lines.map((line) => line.trim()),
    );
  } finally {
    await replay.dispose();
  }
});

test('a zero-progress vector write makes replay unavailable without spinning', async () => {
  const replay = createReplay();
  try {
    await replay.append(output(1), 1);
    writerFor(replay).writev = (buffers) =>
      Promise.resolve({ bytesWritten: 0, buffers });
    await rejectsWith(replay.append(output(2), 2), 'REPLAY_UNAVAILABLE');
    await rejectsWith(collect(replay, 0, 2), 'REPLAY_UNAVAILABLE');
  } finally {
    await replay.dispose();
  }
});

test('suffix replay seeks record starts and preserves large UTF-8 records', async () => {
  const replay = createReplay();
  const originalOpen = fs.open;
  let reads = 0;
  const opened = spyOn(fs, 'open').mockImplementation(async (...args) => {
    const file = await originalOpen(...args);
    if (args[1] === 'r') {
      const read = file.read.bind(file);
      file.read = async (...readArgs: Parameters<FileHandle['read']>) => {
        reads += 1;
        return read(...readArgs);
      };
    }
    return file;
  });
  try {
    const lines = Array.from({ length: 4096 }, (_, index) => output(index + 1));
    lines[121] = `${JSON.stringify({ t: 'fail', seq: 122, code: 'BAD_REQUEST', message: '€'.repeat(70_000) })}\n`;
    await appendAll(replay, lines);
    for (const since of [0, 1, 120, 121, 122, 4086, 4096]) {
      reads = 0;
      expect(await collect(replay, since, 4096)).toEqual(
        lines.slice(since).map((line) => line.trim()),
      );
      if (since >= 4086) expect(reads).toBeLessThanOrEqual(2);
    }
    for (const since of [-1, 0.5, NaN, Infinity, 4100]) {
      reads = 0;
      await rejectsWith(collect(replay, since, 4096), 'REPLAY_UNAVAILABLE');
      expect(reads).toBe(0);
    }
  } finally {
    opened.mockRestore();
    await replay.dispose();
  }
});

test('serial checkpoint operations seal an earlier append batch', async () => {
  const replay = createReplay({ segmentBytes: 1, maxBytes: 4096 });
  try {
    const first = replay.append(output(1, 1), 1);
    const checkpoint = replay.saveCheckpoint({ seq: 1, state: 'acknowledged' });
    const second = replay.append(output(2, 1), 2);
    await Promise.all([first, checkpoint, second]);
    expect(await replay.getCheckpoint()).toEqual({
      seq: 1,
      state: 'acknowledged',
    });
    expect(await collect(replay, 1, 2)).toEqual([output(2, 1).trim()]);
    const gaps: number[][] = [];
    await replay.replay(
      0,
      2,
      async () => {},
      (from, to) => {
        gaps.push([from, to]);
      },
    );
    expect(gaps).toEqual([[1, 1]]);
  } finally {
    await replay.dispose();
  }
});

test('an in-flight vector remains charged until disposal closes its descriptor', async () => {
  const budget = new ReplayBudget(4096);
  const replay = createReplay(undefined, budget);
  const release = Promise.withResolvers<void>();
  let writing: Promise<void> | undefined;
  try {
    await replay.append(output(1), 1);
    const file = writerFor(replay);
    const original = file.writev.bind(file);
    const entered = Promise.withResolvers<void>();
    file.writev = async (buffers, position) => {
      const result = await original(buffers, position);
      entered.resolve();
      await release.promise;
      return result;
    };
    writing = replay.append(output(2), 2);
    await entered.promise;
    const disposing = replay.dispose();
    expect(Reflect.get(budget, 'used')).toBe(fstatSync(file.fd).size);
    release.resolve();
    await writing;
    await disposing;
    expect(file.fd).toBe(-1);
    expect(Reflect.get(budget, 'used')).toBe(0);
  } finally {
    release.resolve();
    await writing;
    await replay.dispose();
  }
});

test('sparse replay indexes remain bounded at the full retained transcript limit', async () => {
  const replay = createReplay();
  const count = () => {
    const segments: unknown = Reflect.get(replay, 'segments');
    if (!Array.isArray(segments)) throw new Error('missing replay segments');
    return segments.reduce((sum: number, segment: unknown) => {
      if (
        typeof segment !== 'object' ||
        segment === null ||
        !('index' in segment) ||
        !Array.isArray(segment.index)
      )
        throw new Error('missing sparse replay index');
      return sum + segment.index.length;
    }, 0);
  };
  try {
    for (let seq = 1; seq <= 1024; seq++) {
      const empty = `${JSON.stringify({ t: 'stdout', seq, b64: '' })}\n`;
      const record = `${JSON.stringify({ t: 'stdout', seq, b64: 'x'.repeat(64 * 1024 - Buffer.byteLength(empty)) })}\n`;
      await replay.append(record, seq);
    }
    expect(count()).toBe(1024);
    expect(Reflect.get(replay, 'bytes')).toBe(64 * 1024 * 1024);
    await rejectsWith(replay.append(output(1025), 1025), 'OUTPUT_LIMIT');
    expect(count()).toBe(1024);
  } finally {
    await replay.dispose();
  }
});

test('shared budget exhaustion after a committed prefix never replays partial success', async () => {
  const replay = createReplay(undefined, new ReplayBudget(1000));
  try {
    await replay.append(output(1), 1);
    const file = writerFor(replay);
    const prefixBytes = fstatSync(file.fd).size;
    await rejectsWith(
      Promise.all([replay.append(output(2), 2), replay.append(output(3), 3)]),
      'OUTPUT_LIMIT',
    );
    expect(fstatSync(file.fd).size).toBe(prefixBytes);
    await rejectsWith(collect(replay, 1, 3), 'OUTPUT_LIMIT');
  } finally {
    await replay.dispose();
  }
});
