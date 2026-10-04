import { describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ExecReplay, ReplayBudget } from './exec-replay.ts';

function createReplay(
  limits?: ConstructorParameters<typeof ExecReplay>[0],
  budget?: ReplayBudget,
) {
  return new ExecReplay(limits, budget, tmpdir());
}

function line(seq: number): string {
  return `${JSON.stringify({ t: 'stdout', b64: 'Ynl0ZXM=', seq })}\n`;
}

async function expectOutputLimit(
  work: Promise<unknown>,
  code = 'OUTPUT_LIMIT',
): Promise<void> {
  try {
    await work;
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error('expected an explicit output storage limit');
}

async function collect(replay: ExecReplay, since: number, until: number) {
  const lines: string[] = [];
  const gaps: number[][] = [];
  const cursor = await replay.replay(
    since,
    until,
    async (value) => {
      lines.push(value);
    },
    (from, to) => gaps.push([from, to]),
  );
  return { lines, gaps, cursor };
}

describe('disk exec replay', () => {
  test.each([
    { t: 'stdout', seq: 1 },
    { t: 'stdout', seq: 1, b64: '@@@@' },
    { t: 'stdout', seq: 1.5, b64: 'YQ==' },
    { t: 'gap', seq: 1, fromSeq: 2, toSeq: 1 },
    {
      t: 'exit',
      seq: 1,
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
      cancelled: false,
      truncated: {},
    },
  ])(
    'rejects corrupt recorded payloads before delivering or advancing: %j',
    async (event) => {
      const replay = createReplay();
      const delivered: string[] = [];
      try {
        await replay.append(`${JSON.stringify(event)}\n`, 1);
        await expectOutputLimit(
          replay.replay(
            0,
            1,
            async (value) => {
              delivered.push(value);
            },
            () => {
              throw new Error('corruption is not a retention gap');
            },
          ),
          'REPLAY_UNAVAILABLE',
        );
        expect(delivered).toEqual([]);
      } finally {
        await replay.dispose();
      }
    },
  );

  test('keeps large output on disk and replays only newer events', async () => {
    const replay = createReplay();
    try {
      const payload = 'a'.repeat(64 * 1024);
      for (let seq = 1; seq <= 8; seq++)
        await replay.append(
          `${JSON.stringify({ t: 'stdout', b64: payload, seq })}\n`,
          seq,
        );
      const result = await collect(replay, 2, 8);
      expect(result.lines).toHaveLength(6);
      expect(result.gaps).toEqual([]);
      expect(result.cursor).toBe(8);
    } finally {
      await replay.dispose();
    }
  });

  test('commits checkpoint before pruning acknowledged output and rejects stale writes', async () => {
    const replay = createReplay({ segmentBytes: 1, maxBytes: 4096 });
    try {
      for (let seq = 1; seq <= 5; seq++) await replay.append(line(seq), seq);
      expect(
        await replay.saveCheckpoint({
          seq: 3,
          state: { pendingTasks: ['task-1'], partialLine: '{' },
        }),
      ).toBe(true);
      expect(await replay.getCheckpoint()).toEqual({
        seq: 3,
        state: { pendingTasks: ['task-1'], partialLine: '{' },
      });
      expect(await replay.saveCheckpoint({ seq: 2, state: null })).toBe(false);
      expect((await collect(replay, 3, 5)).lines).toEqual([
        line(4).trim(),
        line(5).trim(),
      ]);
      expect((await collect(replay, 0, 5)).gaps).toEqual([[1, 3]]);
    } finally {
      await replay.dispose();
    }
  });

  test('fails explicitly instead of discarding unacknowledged history at the disk limit', async () => {
    const replay = createReplay({
      segmentBytes: 1,
      maxBytes: Buffer.byteLength(line(1)) * 2,
    });
    try {
      for (let seq = 1; seq <= 2; seq++) await replay.append(line(seq), seq);
      await expectOutputLimit(replay.append(line(3), 3));
      await expectOutputLimit(collect(replay, 0, 3));
    } finally {
      await replay.dispose();
    }
  });

  test('checkpoint acknowledgements let lifetime output exceed the per-exec cap', async () => {
    const replay = createReplay({
      segmentBytes: 1,
      maxBytes: Buffer.byteLength(line(1)) * 2,
    });
    try {
      for (let seq = 1; seq <= 10; seq++) {
        await replay.append(line(seq), seq);
        await replay.saveCheckpoint({ seq, state: { consumed: seq } });
      }
      expect(await replay.getCheckpoint()).toEqual({
        seq: 10,
        state: { consumed: 10 },
      });
      expect((await collect(replay, 10, 10)).gaps).toEqual([]);
    } finally {
      await replay.dispose();
    }
  });

  test('a failed directory sync after checkpoint rename prevents stale replacement or further output', async () => {
    const replay = createReplay();
    const originalOpen = fs.open;
    let syncFailures = 0;
    const opened = spyOn(fs, 'open').mockImplementation(async (...args) => {
      const file = await originalOpen(...args);
      if (args[1] === 'r') {
        file.sync = async () => {
          syncFailures += 1;
          throw Object.assign(new Error('directory sync failed'), {
            code: 'EIO',
          });
        };
      }
      return file;
    });
    try {
      await replay.append(line(1), 1);
      await replay.append(line(2), 2);
      const result = await replay
        .saveCheckpoint({ seq: 2, state: 'newer' })
        .catch(() => undefined);
      expect(result).toBeUndefined();
      expect(syncFailures).toBe(1);
      opened.mockRestore();
      const directory: unknown = await Reflect.get(replay, 'directory');
      if (typeof directory !== 'string')
        throw new Error('missing spool directory');
      const committed = await fs.readFile(
        join(directory, 'checkpoint.json'),
        'utf8',
      );
      expect(JSON.parse(committed)).toEqual({ seq: 2, state: 'newer' });
      await expectOutputLimit(
        replay.saveCheckpoint({ seq: 1, state: 'stale' }),
        'REPLAY_UNAVAILABLE',
      );
      await expectOutputLimit(replay.getCheckpoint(), 'REPLAY_UNAVAILABLE');
      await expectOutputLimit(replay.append(line(3), 3), 'REPLAY_UNAVAILABLE');
      expect(
        await fs.readFile(join(directory, 'checkpoint.json'), 'utf8'),
      ).toBe(committed);
    } finally {
      opened.mockRestore();
      await replay.dispose();
    }
  });

  test('every snapshot segment remains readable while a checkpoint prunes future ones', async () => {
    const replay = createReplay({
      segmentBytes: Buffer.byteLength(line(1)) * 2,
      maxBytes: 4096,
    });
    try {
      for (let seq = 1; seq <= 4; seq++) await replay.append(line(seq), seq);
      const received: string[] = [];
      const gaps: number[][] = [];
      await replay.replay(
        0,
        4,
        async (value) => {
          received.push(value);
          if (received.length === 1)
            await replay.saveCheckpoint({ seq: 4, state: {} });
        },
        (from, to) => gaps.push([from, to]),
      );
      expect(received).toEqual([1, 2, 3, 4].map((seq) => line(seq).trim()));
      expect(gaps).toEqual([]);
    } finally {
      await replay.dispose();
    }
  });

  test('abort stops paced replay before reading the rest', async () => {
    const replay = createReplay();
    try {
      for (let seq = 1; seq <= 3; seq++) await replay.append(line(seq), seq);
      const controller = new AbortController();
      let count = 0;
      await replay.replay(
        0,
        3,
        async () => {
          count++;
          controller.abort();
        },
        () => {
          throw new Error('unexpected gap');
        },
        controller.signal,
      );
      expect(count).toBe(1);
    } finally {
      await replay.dispose();
    }
  });

  test('checkpoint pruning keeps leased physical bytes charged until a stalled reader closes', async () => {
    const budget = new ReplayBudget(250);
    const limits = { segmentBytes: 1, maxBytes: 1000 };
    const replay = createReplay(limits, budget);
    const denied = createReplay(limits, budget);
    const later = createReplay(limits, budget);
    const abort = new AbortController();
    const entered = Promise.withResolvers<void>();
    const blocked = Promise.withResolvers<void>();
    let reading: Promise<number> | undefined;
    try {
      for (let seq = 1; seq <= 3; seq++) await replay.append(line(seq), seq);
      reading = replay.replay(
        0,
        3,
        async () => {
          entered.resolve();
          await blocked.promise;
        },
        () => {
          throw new Error('unexpected gap');
        },
        abort.signal,
      );
      await entered.promise;
      await replay.saveCheckpoint({ seq: 3, state: null });
      const large = `${JSON.stringify({ t: 'stdout', seq: 1, b64: 'x'.repeat(132) })}\n`;
      await expectOutputLimit(denied.append(large, 1));
      abort.abort();
      await reading;
      await later.append(large, 1);
      expect((await collect(later, 0, 1)).lines).toEqual([large.trim()]);
    } finally {
      abort.abort();
      blocked.resolve();
      await reading;
      await Promise.all([replay.dispose(), denied.dispose(), later.dispose()]);
    }
  });
});
