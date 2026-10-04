import { expect, spyOn, test } from 'bun:test';
import { fstatSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

import { ExecJournal, JournalBudget } from './exec-journal.ts';
import type { RunnerdExecEvent } from './protocol.ts';

// Observe the real private descriptor, following the physical-budget regression
// in exec-manager.test.ts. Production has no test-only I/O or indexing API.
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

async function fileFor(journal: ExecJournal): Promise<FileHandle> {
  const value: unknown = await Reflect.get(journal, 'ready');
  if (!isFileHandle(value)) throw new Error('missing journal descriptor');
  return value;
}

function output(seq: number, bytes = 384): RunnerdExecEvent {
  return {
    t: seq % 2 === 0 ? 'stdout' : 'stderr',
    seq,
    b64: Buffer.alloc(bytes, seq % 256).toString('base64'),
  };
}

function exit(seq: number): RunnerdExecEvent {
  return {
    t: 'exit',
    seq,
    exitCode: 0,
    durationMs: 1,
    timedOut: false,
    cancelled: false,
    truncated: { stdout: false, stderr: false },
  };
}

function line(event: RunnerdExecEvent): string {
  return JSON.stringify(event) + '\n';
}

async function appendAll(journal: ExecJournal, events: RunnerdExecEvent[]) {
  for (const event of events) {
    if (!journal.append(line(event))) await journal.drain();
  }
  await journal.drain();
}

async function replay(journal: ExecJournal, sinceSeq: number) {
  const events: RunnerdExecEvent[] = [];
  await journal.replay((event) => {
    events.push(event);
  }, sinceSeq);
  return events;
}

test('queued records use bounded vector writes and survive short writes across records', async () => {
  const failures: string[] = [];
  const journal = new ExecJournal(
    new JournalBudget(),
    () => {},
    (code) => failures.push(code),
  );
  try {
    const file = await fileFor(journal);
    const writev = file.writev.bind(file);
    const requests: { vectors: number; bytes: number }[] = [];
    file.writev = async (buffers, position) => {
      const bytes = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
      requests.push({ vectors: buffers.length, bytes });
      if (requests.length === 1) {
        // End inside the second record, exercising both a consumed vector and
        // a partial vector. Only the kernel's actual byte count is committed.
        const prefix = Buffer.concat(
          buffers.map((buffer) =>
            Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength),
          ),
        ).subarray(0, buffers[0]!.byteLength + 7);
        const result = await writev([prefix], position);
        return { bytesWritten: result.bytesWritten, buffers };
      }
      return writev(buffers, position);
    };
    const events = Array.from({ length: 300 }, (_, index) =>
      output(index + 1, 1024),
    );
    events.push(exit(events.length + 1));
    await appendAll(journal, events);
    journal.finish();
    expect(requests.length).toBeLessThan(15);
    expect(
      requests.every(
        (request) => request.vectors <= 64 && request.bytes <= 128 * 1024,
      ),
    ).toBe(true);
    expect(requests.some((request) => request.vectors > 1)).toBe(true);
    expect(await replay(journal, 0)).toEqual([
      { t: 'replay-start' },
      ...events.slice(0, -1),
      { t: 'replay-complete', throughSeq: events.length },
      ...events.slice(-1),
    ]);
    expect(failures).toEqual([]);
  } finally {
    await journal.dispose();
  }
});

test('cursor replay seeks to a record boundary and reads only the unseen tail', async () => {
  const journal = new ExecJournal(
    new JournalBudget(),
    () => {},
    () => {},
  );
  try {
    const events = Array.from({ length: 4096 }, (_, index) =>
      output(index + 1),
    );
    // An individual record may span several read chunks; checkpoints must
    // never land inside it, or split UTF-8 / JSON into an invalid suffix.
    events[121] = {
      t: 'fail',
      seq: 122,
      code: 'BAD_REQUEST',
      message: '€'.repeat(70_000),
    };
    events.push(exit(events.length + 1));
    await appendAll(journal, events);
    journal.finish();
    const file = await fileFor(journal);
    const reads = spyOn(file, 'read');
    for (const cursor of [
      0,
      1,
      120,
      121,
      122,
      events.length - 10,
      events.length,
    ]) {
      reads.mockClear();
      const actual = await replay(journal, cursor);
      expect(actual.filter((event) => event.seq !== undefined)).toEqual(
        events.filter((event) => (event.seq ?? 0) > cursor),
      );
      expect(actual[0]).toEqual({ t: 'replay-start' });
      const caughtUp = actual.findIndex(
        (event) => event.t === 'replay-complete',
      );
      expect(caughtUp).toBeGreaterThan(0);
      expect(actual[caughtUp]).toEqual({
        t: 'replay-complete',
        throughSeq: events.length,
      });
      if (cursor < events.length) expect(actual[caughtUp + 1]?.t).toBe('exit');
      if (cursor >= events.length - 10)
        expect(reads.mock.calls.length).toBeLessThanOrEqual(2);
    }
    for (const cursor of [-1, 0.5, NaN, Infinity, events.length + 10]) {
      reads.mockClear();
      expect(await replay(journal, cursor)).toEqual([
        {
          t: 'fail',
          code: 'REPLAY_UNAVAILABLE',
          message: 'Invalid execution replay cursor.',
        },
      ]);
      expect(reads).not.toHaveBeenCalled();
    }
  } finally {
    await journal.dispose();
  }
});

test('concurrent cursor readers wait for committed data and mark the captured prefix before live output', async () => {
  const journal = new ExecJournal(
    new JournalBudget(),
    () => {},
    () => {},
  );
  const release = Promise.withResolvers<void>();
  const controllers = [new AbortController(), new AbortController()];
  const readers: Promise<void>[] = [];
  try {
    const history = Array.from({ length: 300 }, (_, index) =>
      output(index + 1),
    );
    await appendAll(journal, history);
    const file = await fileFor(journal);
    const writev = file.writev.bind(file);
    const entered = Promise.withResolvers<void>();
    let first = true;
    file.writev = async (buffers, position) => {
      if (first) {
        first = false;
        const buffer = buffers[0]!;
        const prefix = Buffer.from(buffer.buffer, buffer.byteOffset, 11);
        const result = await writev([prefix], position);
        entered.resolve();
        await release.promise;
        return { bytesWritten: result.bytesWritten, buffers };
      }
      return writev(buffers, position);
    };
    const pending = output(301, 128 * 1024);
    journal.append(line(pending));
    await entered.promise;
    const seen: RunnerdExecEvent[][] = [[], []];
    const ready = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    const caughtUp = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    for (const index of [0, 1]) {
      readers.push(
        journal.replay(
          (event) => {
            seen[index]!.push(event);
            if (event.t === 'replay-start') ready[index]!.resolve();
            if (event.t === 'replay-complete') caughtUp[index]!.resolve();
          },
          // A live consumer may have seen the queued record before it is
          // committed, but cannot legitimately have seen a future record.
          index === 0 ? 300 : 301,
          controllers[index]!.signal,
        ),
      );
    }
    await Promise.all(ready.map((entry) => entry.promise));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(seen.flat()).toEqual([{ t: 'replay-start' }, { t: 'replay-start' }]);
    release.resolve();
    await journal.drain();
    await Promise.all(caughtUp.map((entry) => entry.promise));
    const live = output(302);
    const terminal = exit(303);
    await appendAll(journal, [live, terminal]);
    journal.finish();
    await Promise.all(readers);
    expect(seen[0]).toEqual([
      { t: 'replay-start' },
      pending,
      { t: 'replay-complete', throughSeq: 301 },
      live,
      terminal,
    ]);
    expect(seen[1]).toEqual([
      { t: 'replay-start' },
      { t: 'replay-complete', throughSeq: 301 },
      live,
      terminal,
    ]);
  } finally {
    release.resolve();
    for (const controller of controllers) controller.abort();
    await Promise.all(readers);
    await journal.dispose();
  }
});

test('a zero-progress vector write fails explicitly instead of spinning', async () => {
  const failures: string[] = [];
  const journal = new ExecJournal(
    new JournalBudget(),
    () => {},
    (code) => failures.push(code),
  );
  try {
    const file = await fileFor(journal);
    file.writev = (buffers) => Promise.resolve({ bytesWritten: 0, buffers });
    journal.append(line(output(1)));
    await journal.drain();
    expect(failures).toEqual(['REPLAY_UNAVAILABLE']);
    expect(await replay(journal, 0)).toMatchObject([
      { t: 'replay-start' },
      { t: 'fail', code: 'REPLAY_UNAVAILABLE' },
    ]);
  } finally {
    await journal.dispose();
  }
});

test('disposal during an in-flight vector write keeps disk charged until the descriptor closes', async () => {
  const budget = new JournalBudget(4096);
  const journal = new ExecJournal(
    budget,
    () => {},
    () => {},
  );
  const release = Promise.withResolvers<void>();
  try {
    const file = await fileFor(journal);
    const writev = file.writev.bind(file);
    const entered = Promise.withResolvers<void>();
    let writes = 0;
    file.writev = async (buffers, position) => {
      writes += 1;
      const result = await writev(buffers, position);
      entered.resolve();
      await release.promise;
      return result;
    };
    journal.append(line(output(1)));
    await entered.promise;
    const disposing = journal.dispose();
    const physicalBytes = fstatSync(file.fd).size;
    expect(physicalBytes).toBeGreaterThan(0);
    expect(Reflect.get(budget, 'used')).toBe(physicalBytes);
    release.resolve();
    await disposing;
    expect(file.fd).toBe(-1);
    expect(Reflect.get(budget, 'used')).toBe(0);
    expect(writes).toBe(1);
  } finally {
    release.resolve();
    await journal.dispose();
  }
});

test('session budget exhaustion after a written prefix never emits successful replay', async () => {
  const budget = new JournalBudget(1000);
  const failures: string[] = [];
  const journal = new ExecJournal(
    budget,
    () => {},
    (code) => failures.push(code),
  );
  try {
    const file = await fileFor(journal);
    await appendAll(journal, [output(1)]);
    const prefixBytes = fstatSync(file.fd).size;
    await appendAll(journal, [output(2), exit(3)]);
    journal.finish();
    expect(failures).toEqual(['OUTPUT_LIMIT']);
    expect(fstatSync(file.fd).size).toBe(prefixBytes);
    expect(await replay(journal, 1)).toMatchObject([
      { t: 'replay-start' },
      { t: 'fail', code: 'OUTPUT_LIMIT' },
    ]);
  } finally {
    await journal.dispose();
  }
});

test('sparse checkpoints remain bounded at the full transcript limit', async () => {
  const failures: string[] = [];
  const journal = new ExecJournal(
    new JournalBudget(),
    () => {},
    (code) => failures.push(code),
  );
  try {
    for (let seq = 1; seq <= 1024; seq += 1) {
      const empty = line({ t: 'stdout', seq, b64: '' });
      const record = line({
        t: 'stdout',
        seq,
        b64: 'x'.repeat(64 * 1024 - Buffer.byteLength(empty)),
      });
      if (!journal.append(record)) await journal.drain();
    }
    await journal.drain();
    const checkpoints: unknown = Reflect.get(journal, 'checkpoints');
    expect(Array.isArray(checkpoints) ? checkpoints.length : undefined).toBe(
      1024,
    );
    const file = await fileFor(journal);
    expect(fstatSync(file.fd).size).toBe(64 * 1024 * 1024);
    expect(journal.append(line(output(1025)))).toBe(false);
    expect(failures).toEqual(['OUTPUT_LIMIT']);
    expect(Array.isArray(checkpoints) ? checkpoints.length : undefined).toBe(
      1024,
    );
  } finally {
    await journal.dispose();
  }
});
