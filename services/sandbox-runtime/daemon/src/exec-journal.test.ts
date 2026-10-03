import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ExecJournal, JournalBudget } from './exec-journal.ts';
import type { RunnerdExecEvent } from './protocol.ts';

const directory = await mkdtemp(join(tmpdir(), 'runnerd-journal-test-'));
afterAll(() => rm(directory, { recursive: true, force: true }));

function output(seq: number): Extract<RunnerdExecEvent, { t: 'stdout' }> {
  return {
    t: 'stdout',
    seq,
    b64: Buffer.alloc(32 * 1024, seq % 256).toString('base64'),
  };
}
function append(journal: ExecJournal, event: RunnerdExecEvent): boolean {
  return journal.append(`${JSON.stringify(event)}\n`);
}
async function fill(journal: ExecJournal, count: number): Promise<void> {
  for (let seq = 1; seq <= count; seq += 1) {
    if (!append(journal, output(seq))) await journal.drain();
  }
  await journal.drain();
}
async function replay(
  journal: ExecJournal,
  since = 0,
): Promise<RunnerdExecEvent[]> {
  const events: RunnerdExecEvent[] = [];
  const controller = new AbortController();
  await journal.replay(
    (event) => {
      events.push(event);
      if (event.t === 'replay-complete') controller.abort();
    },
    since,
    controller.signal,
  );
  return events;
}

describe('exec replay journal', () => {
  test('replays before the RAM ring and resumes a cursor without named files', async () => {
    const journal = new ExecJournal(
      new JournalBudget(),
      () => {},
      () => {},
      undefined,
      directory,
    );
    try {
      await fill(journal, 50);
      expect(await replay(journal)).toEqual([
        { t: 'replay-start' },
        ...Array.from({ length: 50 }, (_, i) => output(i + 1)),
        { t: 'replay-complete', throughSeq: 50 },
      ]);
      expect(await readdir(directory)).toEqual([]);
      expect(await replay(journal, 48)).toEqual([
        { t: 'replay-start' },
        output(49),
        output(50),
        { t: 'replay-complete', throughSeq: 50 },
      ]);
    } finally {
      await journal.dispose();
    }
  });

  test('invalid and future cursors fail closed', async () => {
    const journal = new ExecJournal(
      new JournalBudget(),
      () => {},
      () => {},
      undefined,
      directory,
    );
    try {
      await fill(journal, 1);
      for (const cursor of [-1, 1.5, 2, Infinity]) {
        const events = await replay(journal, cursor);
        expect(events).toHaveLength(2);
        expect(events[1]).toMatchObject({ t: 'fail', code: 'OUTPUT_GAP' });
      }
    } finally {
      await journal.dispose();
    }
  });

  test('an empty live transcript completes catch-up and aborts without waiting for output', async () => {
    const journal = new ExecJournal(
      new JournalBudget(),
      () => {},
      () => {},
      undefined,
      directory,
    );
    try {
      expect(await replay(journal)).toEqual([
        { t: 'replay-start' },
        { t: 'replay-complete', throughSeq: 0 },
      ]);
    } finally {
      await journal.dispose();
    }
  });

  test('output appended during replay is delivered before catch-up completes, exactly once', async () => {
    const journal = new ExecJournal(
      new JournalBudget(),
      () => {},
      () => {},
      undefined,
      directory,
    );
    try {
      await fill(journal, 12);
      const seen: RunnerdExecEvent[] = [];
      const controller = new AbortController();
      await journal.replay(
        async (event) => {
          seen.push(event);
          if (event.seq === 12) {
            append(journal, output(13));
            await journal.drain();
          }
          if (event.t === 'replay-complete') controller.abort();
        },
        0,
        controller.signal,
      );
      expect(seen.filter((event) => event.t === 'stdout')).toEqual(
        Array.from({ length: 13 }, (_, i) => output(i + 1)),
      );
      expect(seen.at(-1)).toEqual({ t: 'replay-complete', throughSeq: 13 });
    } finally {
      await journal.dispose();
    }
  });

  test('corrupt sequence history fails rather than forwarding a terminal tail', async () => {
    const journal = new ExecJournal(
      new JournalBudget(),
      () => {},
      () => {},
      undefined,
      directory,
    );
    try {
      append(journal, output(30));
      await journal.drain();
      const events = await replay(journal);
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        t: 'fail',
        code: 'REPLAY_UNAVAILABLE',
      });
    } finally {
      await journal.dispose();
    }
  });

  test('disk cap marks failure and never returns a successful RAM-only tail', async () => {
    const failures: string[] = [];
    const journal = new ExecJournal(
      new JournalBudget(),
      () => {},
      (failure) => failures.push(failure),
      100_000,
      directory,
    );
    try {
      await fill(journal, 30);
      expect(failures).toEqual(['OUTPUT_LIMIT']);
      const events = await replay(journal);
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({ t: 'fail', code: 'OUTPUT_LIMIT' });
    } finally {
      await journal.dispose();
    }
  });

  test('abort during replay stops before later control events', async () => {
    const journal = new ExecJournal(
      new JournalBudget(),
      () => {},
      () => {},
      undefined,
      directory,
    );
    try {
      await fill(journal, 30);
      const controller = new AbortController();
      const seen: RunnerdExecEvent[] = [];
      await journal.replay(
        (event) => {
          seen.push(event);
          if (event.seq === 1) controller.abort();
        },
        0,
        controller.signal,
      );
      expect(seen).toEqual([{ t: 'replay-start' }, output(1)]);
    } finally {
      await journal.dispose();
    }
  });

  test('a stalled write reports failure promptly while its disk reservation remains owned', async () => {
    const budget = new JournalBudget(50_000);
    const failed = Promise.withResolvers<string>();
    const journal = new ExecJournal(
      budget,
      () => {},
      (code) => failed.resolve(code),
      undefined,
      directory,
      30,
    );
    const gate = Promise.withResolvers<void>();
    try {
      const handle: unknown = await Reflect.get(journal, 'ready');
      if (handle === null || typeof handle !== 'object')
        throw new Error('missing journal descriptor');
      Reflect.set(handle, 'write', async () => {
        await gate.promise;
        return { bytesWritten: 0 };
      });
      append(journal, output(1));
      expect(await failed.promise).toBe('REPLAY_UNAVAILABLE');
      const events = await replay(journal);
      expect(events.at(-1)).toMatchObject({
        t: 'fail',
        code: 'REPLAY_UNAVAILABLE',
      });
      let closed = false;
      const disposing = journal.dispose().then(() => {
        closed = true;
        return undefined;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      expect(await budget.reserve(10_000)).toBe(false);
      gate.resolve();
      await disposing;
      expect(await budget.reserve(50_000)).toBe(true);
      budget.release(50_000);
    } finally {
      gate.resolve();
      await journal.dispose();
    }
  });

  test('aborted stalled reads retain their descriptor until the actual I/O settles', async () => {
    const journal = new ExecJournal(
      new JournalBudget(),
      () => {},
      () => {},
      undefined,
      directory,
      30,
    );
    const gate = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    try {
      await fill(journal, 1);
      const handle: unknown = await Reflect.get(journal, 'ready');
      if (handle === null || typeof handle !== 'object')
        throw new Error('missing journal descriptor');
      Reflect.set(handle, 'read', async () => {
        entered.resolve();
        await gate.promise;
        return { bytesRead: 0 };
      });
      const controller = new AbortController();
      const events: RunnerdExecEvent[] = [];
      const reading = journal.replay(
        (event) => {
          events.push(event);
        },
        0,
        controller.signal,
      );
      await entered.promise;
      controller.abort();
      await reading;
      expect(events).toEqual([{ t: 'replay-start' }]);
      let closed = false;
      const disposing = journal.dispose().then(() => {
        closed = true;
        return undefined;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      gate.resolve();
      await disposing;
      expect(closed).toBe(true);
    } finally {
      gate.resolve();
      await journal.dispose();
    }
  });

  test('the default journal rejects a symlinked runtime directory', async () => {
    const root = await mkdtemp(join(directory, 'workspace-'));
    const outside = await mkdtemp(join(directory, 'outside-'));
    const previous = process.env.TALE_WORKSPACE_ROOT;
    process.env.TALE_WORKSPACE_ROOT = root;
    await symlink(outside, join(root, '.runtime'));
    const journal = new ExecJournal(
      new JournalBudget(),
      () => {},
      () => {},
    );
    try {
      const events = await replay(journal);
      expect(events.at(-1)).toMatchObject({
        t: 'fail',
        code: 'REPLAY_UNAVAILABLE',
      });
      expect(await readdir(outside)).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.TALE_WORKSPACE_ROOT;
      else process.env.TALE_WORKSPACE_ROOT = previous;
      await journal.dispose();
    }
  });
});
