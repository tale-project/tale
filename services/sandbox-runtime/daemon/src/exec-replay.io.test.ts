import { expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ExecReplay, ReplayBudget } from './exec-replay.ts';

const line = (seq: number) =>
  `${JSON.stringify({ t: 'stdout', seq, b64: 'eA==' })}\n`;
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
function writer(replay: ExecReplay): FileHandle {
  const value: unknown = Reflect.get(replay, 'writer');
  if (!isFileHandle(value)) throw new Error('missing writer');
  return value;
}
async function unavailable(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch (error) {
    expect(error).toMatchObject({ code: 'REPLAY_UNAVAILABLE' });
    return;
  }
  throw new Error('expected unavailable replay');
}

test('stalled write fails promptly but owns physical bytes until the kernel operation settles', async () => {
  const budget = new ReplayBudget(4096);
  const replay = new ExecReplay(undefined, budget, tmpdir(), 30);
  const gate = Promise.withResolvers<void>();
  try {
    await replay.append(line(1), 1);
    writer(replay).writev = async (buffers) => {
      await gate.promise;
      return { bytesWritten: 0, buffers };
    };
    await unavailable(replay.append(line(2), 2));
    let disposed = false;
    const closing = replay.dispose().then(() => {
      disposed = true;
      return undefined;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    expect(Reflect.get(budget, 'used')).toBe(
      Buffer.byteLength(line(1) + line(2)),
    );
    gate.resolve();
    await closing;
    expect(Reflect.get(budget, 'used')).toBe(0);
  } finally {
    gate.resolve();
    await replay.dispose();
  }
});

test.each(['abort', 'timeout'])(
  'a stalled read detaches on %s without closing its pending descriptor',
  async (mode) => {
    const budget = new ReplayBudget(4096);
    const replay = new ExecReplay(undefined, budget, tmpdir(), 30);
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const controller = new AbortController();
    const realOpen = fs.open;
    let handle: FileHandle | undefined;
    const opened = spyOn(fs, 'open').mockImplementation(async (...args) => {
      const file = await realOpen(...args);
      if (args[1] === 'r' && String(args[0]).endsWith('.ndjson')) {
        handle = file;
        file.read = async (buffer) => {
          entered.resolve();
          await gate.promise;
          return { bytesRead: 0, buffer };
        };
      }
      return file;
    });
    try {
      await replay.append(line(1), 1);
      const seen: string[] = [];
      const reading = replay.replay(
        0,
        1,
        async (value) => {
          seen.push(value);
        },
        () => {
          throw new Error('unexpected gap');
        },
        controller.signal,
      );
      await entered.promise;
      if (mode === 'abort') {
        controller.abort();
        await reading;
      } else await unavailable(reading);
      expect(seen).toEqual([]);
      expect(handle?.fd).toBeGreaterThanOrEqual(0);
      let disposed = false;
      const closing = replay.dispose().then(() => {
        disposed = true;
        return undefined;
      });
      await Promise.resolve();
      expect(disposed).toBe(false);
      expect(Reflect.get(budget, 'used')).toBe(Buffer.byteLength(line(1)));
      gate.resolve();
      await closing;
      expect(handle?.fd).toBe(-1);
      expect(Reflect.get(budget, 'used')).toBe(0);
    } finally {
      gate.resolve();
      opened.mockRestore();
      await replay.dispose();
    }
  },
);

test.each([
  { sequences: [1, 1] },
  { sequences: [1, 3] },
  { sequences: [2, 1] },
])(
  'corrupt disk sequences %j fail instead of masquerading as checkpoint retention',
  async ({ sequences }) => {
    const replay = new ExecReplay(undefined, undefined, tmpdir());
    try {
      for (const [index, sequence] of sequences.entries())
        await replay.append(line(sequence), index + 1);
      await unavailable(
        replay.replay(
          0,
          2,
          async () => {},
          () => {
            throw new Error('corrupt history is not a gap');
          },
        ),
      );
    } finally {
      await replay.dispose();
    }
  },
);

test('default workspace spool rejects a symlinked runtime directory', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'replay-root-'));
  const outside = await fs.mkdtemp(join(tmpdir(), 'replay-outside-'));
  const previous = process.env.TALE_WORKSPACE_ROOT;
  process.env.TALE_WORKSPACE_ROOT = root;
  await fs.symlink(outside, join(root, '.runtime'));
  const replay = new ExecReplay();
  try {
    await unavailable(replay.append(line(1), 1));
    expect(await fs.readdir(outside)).toEqual([]);
  } finally {
    if (previous === undefined) delete process.env.TALE_WORKSPACE_ROOT;
    else process.env.TALE_WORKSPACE_ROOT = previous;
    await replay.dispose();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('a stalled checkpoint bounds queued callers while its actual write remains owned', async () => {
  const budget = new ReplayBudget(4096);
  const replay = new ExecReplay(undefined, budget, tmpdir(), 30);
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const originalOpen = fs.open;
  // The checkpoint's write into its temporary file stalls in the kernel.
  const opened = spyOn(fs, 'open').mockImplementation(async (...args) => {
    const file = await originalOpen(...args);
    if (String(args[0]).endsWith('checkpoint.tmp')) {
      const writeFile = file.writeFile.bind(file);
      file.writeFile = async (...writeArgs) => {
        entered.resolve();
        await gate.promise;
        return writeFile(...writeArgs);
      };
    }
    return file;
  });
  try {
    await replay.append(line(1), 1);
    const checkpoint = unavailable(
      replay.saveCheckpoint({ seq: 1, state: 'checkpoint' }),
    );
    await entered.promise;
    const queued = unavailable(replay.append(line(2), 2));
    await Promise.all([checkpoint, queued]);
    expect(Reflect.get(budget, 'used')).toBeGreaterThan(
      Buffer.byteLength(line(1)),
    );
    let disposed = false;
    const closing = replay.dispose().then(() => {
      disposed = true;
      return undefined;
    });
    await unavailable(replay.append(line(3), 3));
    await Promise.resolve();
    expect(disposed).toBe(false);
    gate.resolve();
    await closing;
    expect(Reflect.get(budget, 'used')).toBe(0);
  } finally {
    gate.resolve();
    opened.mockRestore();
    await replay.dispose();
  }
});

test('aborting a pending descriptor open pins its segment through checkpoint pruning', async () => {
  const budget = new ReplayBudget(4096);
  const replay = new ExecReplay(undefined, budget, tmpdir());
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const controller = new AbortController();
  const originalOpen = fs.open;
  const opened = spyOn(fs, 'open').mockImplementation(async (...args) => {
    const file = await originalOpen(...args);
    if (args[1] === 'r' && String(args[0]).endsWith('.ndjson')) {
      entered.resolve();
      await gate.promise;
    }
    return file;
  });
  try {
    await replay.append(line(1), 1);
    const reading = replay.replay(
      0,
      1,
      async () => {},
      () => {},
      controller.signal,
    );
    await entered.promise;
    controller.abort();
    await reading;
    const checkpoint = { seq: 1, state: 'acknowledged' };
    await replay.saveCheckpoint(checkpoint);
    expect(Reflect.get(budget, 'used')).toBe(
      Buffer.byteLength(line(1)) +
        Buffer.byteLength(JSON.stringify(checkpoint)),
    );
    gate.resolve();
    await replay.dispose();
    expect(Reflect.get(budget, 'used')).toBe(0);
  } finally {
    gate.resolve();
    opened.mockRestore();
    await replay.dispose();
  }
});
