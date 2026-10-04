import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { runnerdExec } from '../../../sandbox/src/session/runnerd-client.ts';
import { isRunnerdExecEvent as canonicalEvent } from '../../../sandbox/src/session/runnerd-protocol.ts';
import { EnvStore } from './env-store.ts';
import { ExecJournal } from './exec-journal.ts';
import { ExecManager } from './exec-manager.ts';
import { isRunnerdExecEvent, type RunnerdExecEvent } from './protocol.ts';

const root = realpathSync(mkdtempSync(`${tmpdir()}/exec-completion-`));
const request = {
  cwd: root,
  timeoutMs: 30_000,
  stdoutMaxBytes: 1_000_000,
  stderrMaxBytes: 1_000_000,
};
let previousRoot: string | undefined;

beforeAll(() => {
  previousRoot = process.env.TALE_WORKSPACE_ROOT;
  process.env.TALE_WORKSPACE_ROOT = root;
});

afterAll(() => {
  if (previousRoot === undefined) delete process.env.TALE_WORKSPACE_ROOT;
  else process.env.TALE_WORKSPACE_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true });
});

async function waitFor(ready: () => boolean): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (!ready()) {
    if (performance.now() > deadline) throw new Error('barrier not reached');
    await Bun.sleep(5);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test.skipIf(process.platform !== 'linux')(
  'attach during terminal journal drain cannot rearm the orphan deadline or reap sibling-dependent leftovers',
  async () => {
    const sent: Array<[number, NodeJS.Signals]> = [];
    using manager = new ExecManager(
      new EnvStore(),
      () => {},
      () => {},
      {
        kill: (pid, signal) => {
          sent.push([pid, signal]);
          process.kill(pid, signal);
        },
      },
      { execShim: null },
    );
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const originalDrain: (this: ExecJournal) => Promise<void> = Reflect.get(
      ExecJournal.prototype,
      'drain',
    );
    const drain = spyOn(ExecJournal.prototype, 'drain').mockImplementation(
      async function (this: ExecJournal) {
        entered.resolve();
        await release.promise;
        await originalDrain.call(this);
      },
    );
    const peer = manager.run(
      { ...request, execId: 'completion-peer', command: ['sleep', '60'] },
      () => {},
    );
    const events: RunnerdExecEvent[] = [];
    let survivor = 0;
    let done: Promise<void> | undefined;
    const subscriber = new AbortController();
    try {
      done = manager.run(
        {
          ...request,
          execId: 'completion-finished',
          shell:
            'setsid sleep 60 </dev/null >/dev/null 2>&1 & echo $!; read release',
          stdinMode: 'hold',
        },
        (event) => events.push(event),
      );
      await waitFor(() => {
        const output = events
          .filter((event) => event.t === 'stdout')
          .map((event) => Buffer.from(event.b64, 'base64').toString())
          .join('');
        survivor = Number(output.trim());
        return survivor > 1;
      });
      expect(
        manager.writeStdin('completion-finished', {
          b64: Buffer.from('"go"\n').toString('base64'),
          eof: true,
        }),
      ).toEqual({ ok: true });
      await entered.promise;
      expect(manager.leftoverCount()).toBe(1);
      expect(manager.status('completion-finished')?.state).toBe('running');
      expect(events.some((event) => event.t === 'exit')).toBe(false);
      expect(sent).toEqual([]);
      const deadline = spyOn(globalThis, 'setTimeout');
      let attached: Promise<void> | null;
      let orphanTimers: typeof deadline.mock.calls;
      try {
        attached = manager.attach(
          'completion-finished',
          () => {},
          0,
          subscriber.signal,
        );
        orphanTimers = deadline.mock.calls.filter(
          ([_callback, delay]) => delay === request.timeoutMs,
        );
        for (const [callback] of orphanTimers) callback();
      } finally {
        deadline.mockRestore();
      }
      expect(attached).not.toBeNull();
      if (orphanTimers.length > 0) await waitFor(() => sent.length > 0);
      expect(sent).toEqual([]);
      expect(orphanTimers).toHaveLength(0);
      expect(alive(survivor)).toBe(true);
      expect(manager.leftoverCount()).toBe(1);
      expect(manager.status('completion-finished')?.state).toBe('running');
      release.resolve();
      await done;
      await attached;
      expect(manager.status('completion-finished')).toEqual({
        state: 'exited',
        exitCode: 0,
      });
      expect(events.at(-1)).toMatchObject({
        t: 'exit',
        exitCode: 0,
        timedOut: false,
        cancelled: false,
      });
      expect(alive(survivor)).toBe(true);
      expect(manager.cancel('completion-peer')).toBe(true);
      await peer;
      await waitFor(() => !alive(survivor));
    } finally {
      release.resolve();
      drain.mockRestore();
      subscriber.abort();
      await manager.terminateAll();
      await Promise.all([peer, done]);
      if (survivor > 1 && alive(survivor)) process.kill(survivor, 'SIGKILL');
    }
  },
  15_000,
);

test('a producer exit after a backward wall clock retains epoch start and is accepted by canonical consumers', async () => {
  using manager = new ExecManager(
    new EnvStore(),
    () => {},
    () => {},
    {},
    {
      execShim: null,
    },
  );
  const epoch = Date.now();
  let wallClock = epoch;
  const clock = spyOn(Date, 'now').mockImplementation(() => wallClock);
  const events: RunnerdExecEvent[] = [];
  try {
    await manager.run(
      { ...request, execId: 'completion-clock', command: ['sleep', '0.05'] },
      (event) => {
        events.push(event);
        if (event.t === 'start') wallClock = epoch - 60_000;
      },
    );
  } finally {
    clock.mockRestore();
  }
  expect(events[0]).toMatchObject({ t: 'start', startedAtMs: epoch });
  const exit = events.find((event) => event.t === 'exit');
  expect(exit).toBeDefined();
  expect(exit?.exitCode).toBe(0);
  expect(canonicalEvent(exit)).toBe(true);
  expect(isRunnerdExecEvent(exit)).toBe(true);
  expect(exit?.durationMs).toBeGreaterThanOrEqual(40);
  const replay: RunnerdExecEvent[] = [];
  await manager.attach('completion-clock', (event) => {
    replay.push(event);
  });
  expect(replay.some((event) => event.t === 'fail')).toBe(false);
  expect(replay.find((event) => event.t === 'exit')).toEqual(exit);
  const consumed: RunnerdExecEvent[] = [];
  const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      events.map((event) => JSON.stringify(event)).join('\n') + '\n',
    ),
  );
  try {
    await runnerdExec(
      { baseUrl: 'http://runnerd.test', token: '' },
      { ...request, execId: 'completion-clock', command: ['true'] },
      (event) => consumed.push(event),
    );
    expect(consumed).toEqual(events);
  } finally {
    fetchSpy.mockRestore();
  }
});
