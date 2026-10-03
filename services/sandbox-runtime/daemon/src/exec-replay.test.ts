import { describe, expect, test } from 'bun:test';

import { ExecReplay } from './exec-replay.ts';

function line(seq: number): string {
  return `${JSON.stringify({ t: 'stdout', b64: 'Ynl0ZXM=', seq })}\n`;
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
  test('keeps output beyond the memory ring and replays only newer events', async () => {
    const replay = new ExecReplay();
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
    const replay = new ExecReplay({ segmentBytes: 1, maxBytes: 4096 });
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

  test('reports a precise gap when unacknowledged history exceeds the disk budget', async () => {
    const replay = new ExecReplay({
      segmentBytes: 1,
      maxBytes: Buffer.byteLength(line(1)) * 2,
    });
    try {
      for (let seq = 1; seq <= 6; seq++) await replay.append(line(seq), seq);
      expect((await collect(replay, 0, 6)).gaps).toEqual([[1, 4]]);
      expect((await collect(replay, 4, 6)).lines).toEqual([
        line(5).trim(),
        line(6).trim(),
      ]);
    } finally {
      await replay.dispose();
    }
  });

  test('every snapshot segment remains readable while a checkpoint prunes future ones', async () => {
    const replay = new ExecReplay({
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
    const replay = new ExecReplay();
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
});
