import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { EnvStore } from './env-store.ts';
import { ExecManager } from './exec-manager.ts';
import type { RunnerdExecEvent } from './protocol.ts';

const root = realpathSync(mkdtempSync(`${tmpdir()}/runnerd-replay-order-`));
beforeAll(() => {
  process.env.TALE_WORKSPACE_ROOT = root;
});
afterAll(() => {
  delete process.env.TALE_WORKSPACE_ROOT;
  rmSync(root, { recursive: true, force: true });
});

test('concurrent attachments wait for the captured write and suppress future-cursor duplicates', async () => {
  using manager = new ExecManager(new EnvStore(), () => {});
  const originalOpen = fs.open;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let held = false;
  const opened = spyOn(fs, 'open').mockImplementation(async (...args) => {
    const file = await originalOpen(...args);
    if (args[1] === 'ax') {
      const writev = file.writev.bind(file);
      file.writev = async (buffers, position) => {
        if (
          !held &&
          buffers.some((buffer) =>
            Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
              .toString()
              .includes('"t":"stdout"'),
          )
        ) {
          held = true;
          const first = buffers[0];
          if (!first) throw new Error('missing replay output vector');
          const partial = Buffer.from(first.buffer, first.byteOffset, 11);
          const result = await writev([partial], position);
          entered.resolve();
          await release.promise;
          return { bytesWritten: result.bytesWritten, buffers };
        }
        return writev(buffers, position);
      };
    }
    return file;
  });
  const started = Promise.withResolvers<void>();
  const readers: Array<Promise<void> | null> = [];
  const running = manager.run(
    {
      execId: 'captured-write',
      command: [
        '/bin/sh',
        '-c',
        'read first; printf first; read second; printf second',
      ],
      cwd: root,
      timeoutMs: 10000,
      stdoutMaxBytes: 1000000,
      stderrMaxBytes: 1000000,
      stdinMode: 'hold',
    },
    (event) => {
      if (event.t === 'start') started.resolve();
    },
  );
  try {
    await started.promise;
    expect(
      manager.writeStdin('captured-write', {
        b64: Buffer.from('{}\n').toString('base64'),
      }),
    ).toEqual({ ok: true });
    await entered.promise;
    const seen: RunnerdExecEvent[][] = [[], []];
    const complete = [
      Promise.withResolvers<void>(),
      Promise.withResolvers<void>(),
    ];
    for (const [index, since] of [1, 3].entries()) {
      const events = seen[index];
      const barrier = complete[index];
      if (!events || !barrier) throw new Error('missing attachment fixture');
      readers.push(
        manager.attach(
          'captured-write',
          (event) => {
            events.push(event);
            if (event.t === 'replay-complete') barrier.resolve();
          },
          since,
        ),
      );
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(seen).toEqual([[{ t: 'replay-start' }], [{ t: 'replay-start' }]]);
    release.resolve();
    await Promise.all(complete.map((item) => item.promise));
    expect(
      manager.writeStdin('captured-write', {
        b64: Buffer.from('{}\n').toString('base64'),
        eof: true,
      }),
    ).toEqual({ ok: true });
    await Promise.all([running, ...readers]);
    expect(
      seen.map((events) =>
        events.map((event) =>
          event.t === 'replay-complete'
            ? { t: event.t, throughSeq: event.throughSeq }
            : {
                t: event.t,
                ...(event.seq === undefined ? {} : { seq: event.seq }),
              },
        ),
      ),
    ).toEqual([
      [
        { t: 'replay-start' },
        { t: 'stdout', seq: 2 },
        { t: 'replay-complete', throughSeq: 2 },
        { t: 'stdout', seq: 3 },
        { t: 'exit', seq: 4 },
      ],
      [
        { t: 'replay-start' },
        { t: 'replay-complete', throughSeq: 2 },
        { t: 'exit', seq: 4 },
      ],
    ]);
  } finally {
    release.resolve();
    manager.cancel('captured-write');
    await Promise.all([running, ...readers]);
    opened.mockRestore();
  }
});

test('a terminal vector write failure cannot publish a successful exit or replay barrier', async () => {
  using manager = new ExecManager(new EnvStore(), () => {});
  const originalOpen = fs.open;
  let failures = 0;
  const opened = spyOn(fs, 'open').mockImplementation(async (...args) => {
    const file = await originalOpen(...args);
    if (args[1] === 'ax') {
      const writev = file.writev.bind(file);
      file.writev = (buffers, position) => {
        if (
          buffers.some((buffer) =>
            Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
              .toString()
              .includes('"t":"exit"'),
          )
        ) {
          failures++;
          return Promise.resolve({ bytesWritten: 0, buffers });
        }
        return writev(buffers, position);
      };
    }
    return file;
  });
  try {
    const original: RunnerdExecEvent[] = [];
    await manager.run(
      {
        execId: 'terminal-write',
        command: ['/bin/sh', '-c', 'exit 0'],
        cwd: root,
        timeoutMs: 10000,
        stdoutMaxBytes: 1000000,
        stderrMaxBytes: 1000000,
      },
      (event) => {
        original.push(event);
      },
    );
    expect(failures).toBe(1);
    expect(original.at(-1)).toMatchObject({ t: 'exit', exitCode: -1 });
    expect(
      original.some(
        (event) => event.t === 'fail' && event.code === 'REPLAY_UNAVAILABLE',
      ),
    ).toBe(true);
    expect(manager.status('terminal-write')).toEqual({
      state: 'exited',
      exitCode: -1,
    });
    const replayed: RunnerdExecEvent[] = [];
    await manager.attach('terminal-write', (event) => {
      replayed.push(event);
    });
    expect(replayed).toMatchObject([
      { t: 'replay-start' },
      { t: 'fail', code: 'REPLAY_UNAVAILABLE' },
    ]);
  } finally {
    opened.mockRestore();
  }
});
