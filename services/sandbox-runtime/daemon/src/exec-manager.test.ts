// runnerd exec-manager unit tests. No container needed — these run the host's
// real /bin processes through the manager and assert the NDJSON event shapes,
// cwd validation, dedup, and timeout/cancel. TALE_WORKSPACE_ROOT points the
// cwd-safety check at a temp dir so the happy path is hermetic.

import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { getEventListeners } from 'node:events';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';

import { EnvStore } from './env-store.ts';
import { ExecJournal, JournalBudget } from './exec-journal.ts';
import { ExecManager, isStdinWritable } from './exec-manager.ts';
import { pendingProcReads } from './process-reaper.ts';
import type { RunnerdExecEvent, RunnerdExecRequest } from './protocol.ts';

// realpath the temp dir up front — macOS /tmp is a symlink to /private/tmp, so
// the manager's realpathSync(cwd) must compare against the resolved root.
const ROOT = realpathSync(mkdtempSync(`${tmpdir()}/runnerd-test-`));

beforeAll(() => {
  process.env.TALE_WORKSPACE_ROOT = ROOT;
});
afterAll(() => {
  delete process.env.TALE_WORKSPACE_ROOT;
  rmSync(ROOT, { recursive: true, force: true });
});

function collect(): {
  events: RunnerdExecEvent[];
  emit: (e: RunnerdExecEvent) => void;
} {
  const events: RunnerdExecEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'EPERM') {
      return true;
    }
    return false;
  }
}

/** The pid an exec printed first (`cmd & echo $!`), once it has. */
async function stdoutPid(events: RunnerdExecEvent[]): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    const pid = Number(decode(events, 'stdout').trim());
    if (pid > 1) return pid;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('the exec never printed its pid');
}

async function waitGone(pid: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (isAlive(pid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Let every read waiting on a FIFO come back, and wait until they have. */
async function releaseFifo(fifo: string): Promise<void> {
  const until = Date.now() + 5_000;
  while (pendingProcReads() > 0 && Date.now() < until) {
    try {
      closeSync(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK));
    } catch (err) {
      // ENXIO: the stuck read has not opened the FIFO yet.
      if (!(err instanceof Error && 'code' in err)) throw err;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

function decode(
  events: RunnerdExecEvent[],
  stream: 'stdout' | 'stderr',
): string {
  return events
    .filter(
      (e): e is Extract<RunnerdExecEvent, { t: 'stdout' | 'stderr' }> =>
        e.t === stream,
    )
    .map((e) => Buffer.from(e.b64, 'base64').toString('utf8'))
    .join('');
}

const base: Omit<RunnerdExecRequest, 'execId' | 'command' | 'shell' | 'cwd'> = {
  timeoutMs: 5_000,
  stdoutMaxBytes: 1_000_000,
  stderrMaxBytes: 1_000_000,
};

describe('ExecManager', () => {
  test('streams stdout in order, exits 0', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    await mgr.run(
      { ...base, execId: 'e1', command: ['echo', 'hi'], cwd: ROOT },
      emit,
    );
    expect(events[0]).toMatchObject({ t: 'start', execId: 'e1' });
    expect(decode(events, 'stdout')).toBe('hi\n');
    const last = events[events.length - 1];
    expect(last).toMatchObject({ t: 'exit', exitCode: 0, cancelled: false });
  });

  test('flushes all output before the terminal exit event (ordering contract)', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    // A large stdout burst immediately followed by exit: `cat` echoes the
    // piped payload then EOFs and exits. The close-based finalize must deliver
    // every chunk AND keep the terminal 'exit' strictly last — a finalize on
    // bare 'exit' could let a trailing chunk emit after it.
    const payload = 'x'.repeat(200_000);
    await mgr.run(
      {
        ...base,
        execId: 'ord1',
        command: ['cat'],
        cwd: ROOT,
        stdinBase64: Buffer.from(payload).toString('base64'),
      },
      emit,
    );
    // Nothing dropped near exit.
    expect(decode(events, 'stdout')).toBe(payload);
    // 'exit' is the last event AND carries the highest seq → no stdout/stderr
    // event slipped in after the terminal event.
    const exit = events[events.length - 1];
    expect(exit?.t).toBe('exit');
    const maxSeq = Math.max(...events.map((e) => e.seq ?? 0));
    expect(exit?.seq).toBe(maxSeq);
  });

  test('exit durationMs is the runner-measured elapsed time (spawn → drained exit)', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    const beforeMonotonicMs = performance.now();
    const beforeMs = Date.now();
    await mgr.run(
      { ...base, execId: 'dur1', shell: 'sleep 0.12', cwd: ROOT },
      emit,
    );
    const afterMs = Date.now();
    const elapsedMs = performance.now() - beforeMonotonicMs;
    const start = events.find(
      (e): e is Extract<RunnerdExecEvent, { t: 'start' }> => e.t === 'start',
    );
    const exit = events.find(
      (e): e is Extract<RunnerdExecEvent, { t: 'exit' }> => e.t === 'exit',
    );
    if (!start || !exit) throw new Error('missing start/exit event');
    // The clock starts at spawn time, inside the run() window.
    expect(start.startedAtMs).toBeGreaterThanOrEqual(beforeMs);
    expect(start.startedAtMs).toBeLessThanOrEqual(afterMs);
    // The measurement covers the child's own runtime (a 120ms sleep; allow
    // clock granularity slack) and never exceeds the outer elapsed window —
    // i.e. it contains NO out-of-process phase (staging, harvest, scheduling).
    expect(exit.durationMs).toBeGreaterThanOrEqual(110);
    expect(exit.durationMs).toBeLessThanOrEqual(elapsedMs);
  });

  test('shell form runs via bash -lc, propagates non-zero exit', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    await mgr.run({ ...base, execId: 'e2', shell: 'exit 3', cwd: ROOT }, emit);
    expect(events[events.length - 1]).toMatchObject({ t: 'exit', exitCode: 3 });
  });

  test('runs beforeSpawn ahead of every child (the built-in skill links)', async () => {
    let calls = 0;
    const marker = `${ROOT}/before-spawn-marker`;
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      () => {
        calls += 1;
        writeFileSync(marker, `call ${calls}\n`);
      },
    );
    for (const execId of ['bs1', 'bs2']) {
      const { events, emit } = collect();
      await mgr.run(
        { ...base, execId, command: ['cat', marker], cwd: ROOT },
        emit,
      );
      expect(decode(events, 'stdout')).toBe(`call ${calls}\n`);
    }
    expect(calls).toBe(2);
  });

  test('per-exec env overlay reaches the child; deny-list blocked', async () => {
    using mgr = new ExecManager(
      new EnvStore({ SESSION_VAR: 'base' }),
      () => {},
    );
    const { events, emit } = collect();
    await mgr.run(
      {
        ...base,
        execId: 'e3',
        shell: 'echo "$SESSION_VAR-$OVERLAY-$HOME"',
        cwd: ROOT,
        env: { OVERLAY: 'ov', HOME: '/evil' },
      },
      emit,
    );
    const out = decode(events, 'stdout').trim();
    // SESSION_VAR from store, OVERLAY from overlay, HOME NOT clobbered (deny).
    expect(out.startsWith('base-ov-')).toBe(true);
    expect(out.endsWith('-/evil')).toBe(false);
  });

  test('reads prompt from stdinBase64', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    await mgr.run(
      {
        ...base,
        execId: 'e4',
        command: ['cat'],
        cwd: ROOT,
        stdinBase64: Buffer.from('piped-input').toString('base64'),
      },
      emit,
    );
    expect(decode(events, 'stdout')).toBe('piped-input');
  });

  test('rejects cwd outside the workspace root', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    await mgr.run(
      { ...base, execId: 'e5', command: ['echo', 'x'], cwd: '/etc' },
      emit,
    );
    expect(events[0]).toMatchObject({ t: 'fail', code: 'INVALID_CWD' });
  });

  test('rejects when neither/both of command and shell given', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const both = collect();
    await mgr.run(
      { ...base, execId: 'e6', command: ['echo'], shell: 'echo', cwd: ROOT },
      both.emit,
    );
    expect(both.events[0]).toMatchObject({ t: 'fail', code: 'BAD_REQUEST' });

    const neither = collect();
    await mgr.run({ ...base, execId: 'e7', cwd: ROOT }, neither.emit);
    expect(neither.events[0]).toMatchObject({ t: 'fail', code: 'BAD_REQUEST' });
  });

  test('invalid execId rejected', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    await mgr.run(
      { ...base, execId: 'bad id!', command: ['echo', 'x'], cwd: ROOT },
      emit,
    );
    expect(events[0]).toMatchObject({ t: 'fail', code: 'BAD_REQUEST' });
  });

  test('timeout kills the process group and flags timedOut', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    await mgr.run(
      { ...base, execId: 'e8', timeoutMs: 200, shell: 'sleep 30', cwd: ROOT },
      emit,
    );
    const last = events[events.length - 1];
    expect(last?.t).toBe('exit');
    if (last?.t === 'exit') expect(last.timedOut).toBe(true);
  });

  test('cancel terminates a live exec', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    const done = mgr.run(
      { ...base, execId: 'e9', shell: 'sleep 30', cwd: ROOT },
      emit,
    );
    // Let it start, then cancel.
    await new Promise((r) => setTimeout(r, 150));
    expect(mgr.cancel('e9')).toBe(true);
    await done;
    expect(events[events.length - 1]?.t).toBe('exit');
  });

  test('an exec carries its id in the environment of every process', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    await mgr.run(
      { ...base, execId: 'etag', shell: 'echo "$TALE_EXEC_ID"', cwd: ROOT },
      emit,
    );
    expect(decode(events, 'stdout')).toBe('etag\n');
  });

  test('what an exec left running ends with it, and its exit is not held back', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    // The background sleep inherits stdout: before, it outlived the exec and
    // held the pipe, so the exit waited out the drain grace.
    await mgr.run(
      { ...base, execId: 'ebg', shell: 'sleep 30 & echo $!', cwd: ROOT },
      emit,
    );
    const pid = Number(decode(events, 'stdout').trim());
    expect(pid).toBeGreaterThan(1);
    const last = events[events.length - 1];
    expect(last?.t).toBe('exit');
    if (last?.t === 'exit') expect(last.durationMs).toBeLessThan(1_500);
    const deadline = Date.now() + 3_000;
    while (isAlive(pid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(isAlive(pid)).toBe(false);
  });

  test.skipIf(!existsSync('/proc/self/environ'))(
    'a descendant in a session of its own is found by its tag and ended too',
    async () => {
      using mgr = new ExecManager(new EnvStore(), () => {});
      const { events, emit } = collect();
      await mgr.run(
        {
          ...base,
          execId: 'esid',
          shell:
            'setsid sleep 30 >/dev/null 2>&1 < /dev/null & sleep 0.2; pgrep -n -f "^sleep 30$"',
          cwd: ROOT,
        },
        emit,
      );
      const pid = Number(decode(events, 'stdout').trim());
      expect(pid).toBeGreaterThan(1);
      const deadline = Date.now() + 3_000;
      while (isAlive(pid) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(isAlive(pid)).toBe(false);
    },
  );

  test.skipIf(!existsSync('/proc/self/environ'))(
    'what an exec left waiting in its group ends with the last exec, tag or not',
    async () => {
      using mgr = new ExecManager(new EnvStore(), () => {});
      const long = collect();
      const longDone = mgr.run(
        { ...base, execId: 'eulong', shell: 'sleep 30', cwd: ROOT },
        long.emit,
      );
      while (mgr.status('eulong')?.state !== 'running') {
        await new Promise((r) => setTimeout(r, 10));
      }
      const short = collect();
      // `env -i` drops the tag; the process stays in the exec's group.
      await mgr.run(
        {
          ...base,
          execId: 'eushort',
          shell: 'env -i /bin/sleep 401 >/dev/null 2>&1 & echo $!',
          cwd: ROOT,
        },
        short.emit,
      );
      const pid = Number(decode(short.events, 'stdout').trim());
      expect(pid).toBeGreaterThan(1);
      await new Promise((r) => setTimeout(r, 300));
      expect(isAlive(pid)).toBe(true);
      expect(mgr.leftoverCount()).toBe(1);
      expect(mgr.cancel('eulong')).toBe(true);
      await longDone;
      await waitGone(pid);
      expect(isAlive(pid)).toBe(false);
    },
  );

  test.skipIf(!existsSync('/proc/self/environ'))(
    'an untagged process in the group of an exec that ended alone still gets the SIGKILL',
    async () => {
      using mgr = new ExecManager(new EnvStore(), () => {});
      const { events, emit } = collect();
      await mgr.run(
        {
          ...base,
          execId: 'euterm',
          // Ignores SIGTERM and carries no tag; the exec waits for its trap.
          shell:
            'rm -f ready; env -i /bin/bash -c "trap \'\' TERM; : > ready; exec /bin/sleep 403" >/dev/null 2>&1 & while [ ! -e ready ]; do sleep 0.02; done; echo $!',
          cwd: ROOT,
        },
        emit,
      );
      const pid = Number(decode(events, 'stdout').trim());
      expect(pid).toBeGreaterThan(1);
      await new Promise((r) => setTimeout(r, 1_000));
      expect(isAlive(pid)).toBe(true);
      const deadline = Date.now() + 7_000;
      while (isAlive(pid) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(isAlive(pid)).toBe(false);
    },
    15_000,
  );

  test('a cancelled exec ends its background processes too', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    const done = mgr.run(
      {
        ...base,
        execId: 'ecbg',
        shell: 'sleep 30 & echo $!; wait',
        cwd: ROOT,
      },
      emit,
    );
    let pid = 0;
    const started = Date.now();
    while (pid === 0 && Date.now() - started < 5_000) {
      pid = Number(decode(events, 'stdout').trim()) || 0;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(mgr.cancel('ecbg')).toBe(true);
    await done;
    const deadline = Date.now() + 3_000;
    while (isAlive(pid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(isAlive(pid)).toBe(false);
  });

  test('a cancel signals each process of the exec once', async () => {
    const sent: Array<[number, NodeJS.Signals]> = [];
    using mgr = new ExecManager(new EnvStore(), () => {}, undefined, {
      kill: (pid, signal) => {
        sent.push([pid, signal]);
        process.kill(pid, signal);
      },
    });
    const { events, emit } = collect();
    const done = mgr.run(
      {
        ...base,
        execId: 'eonce',
        shell: 'sleep 30 & echo $!; wait',
        cwd: ROOT,
      },
      emit,
    );
    const pid = await stdoutPid(events);
    expect(mgr.cancel('eonce')).toBe(true);
    await done;
    await waitGone(pid);
    // The shell and its sleep share the exec's group: one signal reaches
    // both. A second SIGTERM would land inside whatever cleanup the first
    // started (a wrapper's, a harness writing its transcript).
    expect(sent.filter(([, signal]) => signal === 'SIGTERM')).toHaveLength(1);
    expect(sent[0]?.[0]).toBeLessThan(0);
  });

  test('a cancel signals the exec’s group at once, even while a read of the process table hangs', async () => {
    // A fake process table in which one process's environment read never
    // comes back: a FIFO no one writes stands in for a process stuck
    // holding its memory lock.
    const procRoot = mkdtempSync(`${tmpdir()}/runnerd-proc-`);
    mkdirSync(`${procRoot}/41`);
    writeFileSync(
      `${procRoot}/41/stat`,
      '41 (stuck) D 1 41 41 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 4141 0 0\n',
    );
    const fifo = `${procRoot}/41/environ`;
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const sent: Array<[number, NodeJS.Signals]> = [];
    // The scan of tags, as without the subreaper shim: under it, a scan
    // reads no environment while every exec's shim runs.
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      {
        procRoot,
        scanDeadlineMs: 500,
        kill: (pid, signal) => {
          sent.push([pid, signal]);
          process.kill(pid, signal);
        },
      },
      { execShim: null },
    );
    try {
      const { events, emit } = collect();
      const done = mgr.run(
        { ...base, execId: 'estuck', shell: 'sleep 30', cwd: ROOT },
        emit,
      );
      while (mgr.status('estuck')?.state !== 'running') {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(mgr.cancel('estuck')).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.[0]).toBeLessThan(0);
      expect(sent[0]?.[1]).toBe('SIGTERM');
      await done;
      expect(events[events.length - 1]).toMatchObject({
        t: 'exit',
        cancelled: true,
      });
    } finally {
      await releaseFifo(fifo);
      rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test('what an exec left running waits while another exec of the session runs', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const long = collect();
    const longDone = mgr.run(
      { ...base, execId: 'elong', shell: 'sleep 30', cwd: ROOT },
      long.emit,
    );
    const short = collect();
    // A dev server the next exec may still use: it outlives its own exec.
    await mgr.run(
      {
        ...base,
        execId: 'eshort',
        shell: 'sleep 30 >/dev/null 2>&1 & echo $!',
        cwd: ROOT,
      },
      short.emit,
    );
    const pid = Number(decode(short.events, 'stdout').trim());
    expect(pid).toBeGreaterThan(1);
    await new Promise((r) => setTimeout(r, 300));
    expect(isAlive(pid)).toBe(true);
    // The session's last exec ends: what the earlier one left ends with it.
    expect(mgr.cancel('elong')).toBe(true);
    await longDone;
    await waitGone(pid);
    expect(isAlive(pid)).toBe(false);
  });

  test('a rotation’s cancel ends the exec’s group and holds what it left outside until the exec after it ends', async () => {
    // A fake process table: a server the turn started in a session of its
    // own, still tagged with the exec.
    const procRoot = mkdtempSync(`${tmpdir()}/runnerd-proc-`);
    mkdirSync(`${procRoot}/99992`);
    writeFileSync(`${procRoot}/99992/environ`, 'TALE_EXEC_ID=erot\0');
    writeFileSync(
      `${procRoot}/99992/stat`,
      '99992 (server) S 1 99992 99992 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 4343 0 0\n',
    );
    const sent: Array<[number, NodeJS.Signals]> = [];
    // Found by its tag alone: no shim of the exec's is its ancestor here.
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      {
        procRoot,
        // Real groups are the test's own execs; the fake pid is only recorded.
        kill: (pid, signal) => {
          sent.push([pid, signal]);
          if (pid < 0) process.kill(pid, signal);
        },
      },
      { execShim: null },
    );
    try {
      const { events, emit } = collect();
      const done = mgr.run(
        { ...base, execId: 'erot', shell: 'sleep 30', cwd: ROOT },
        emit,
      );
      while (mgr.status('erot')?.state !== 'running') {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(mgr.cancel('erot', { keepLeftovers: true })).toBe(true);
      await done;
      expect(events[events.length - 1]).toMatchObject({
        t: 'exit',
        cancelled: true,
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.[0]).toBeLessThan(0);
      // Its own drop, the session's last exec ending, does not end them.
      await new Promise((r) => setTimeout(r, 200));
      expect(sent.some(([pid]) => pid === 99992)).toBe(false);
      expect(mgr.leftoverCount()).toBe(1);
      const second = mgr.run(
        { ...base, execId: 'erot-middle', shell: 'sleep 30', cwd: ROOT },
        () => {},
      );
      expect(mgr.cancel('erot-middle', { keepLeftovers: true })).toBe(true);
      await second;
      expect(mgr.leftoverCount()).toBe(2);
      expect(sent.some(([pid]) => pid === 99992)).toBe(false);
      // The exec that takes over ends: what the cancelled one held ends too.
      await mgr.run(
        { ...base, execId: 'erot-next', command: ['true'], cwd: ROOT },
        () => {},
      );
      const until = Date.now() + 2_000;
      while (!sent.some(([pid]) => pid === 99992) && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(sent).toContainEqual([99992, 'SIGTERM']);
      expect(mgr.leftoverCount()).toBe(0);
    } finally {
      rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test('a rotation snapshot that outlives its leader cannot certify a reused group', async () => {
    const procRoot = mkdtempSync(`${tmpdir()}/runnerd-proc-`);
    const listing = Promise.withResolvers<string[]>();
    const sent: Array<[number, NodeJS.Signals]> = [];
    const mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      {
        procRoot,
        listDir: () => listing.promise,
        kill: (pid, signal) => {
          sent.push([pid, signal]);
        },
      },
      { execShim: null },
    );
    const seen = collect();
    let leader = 0;
    const done = mgr.run(
      {
        ...base,
        execId: 'snapshot-reuse',
        shell: 'echo $$; exec sleep 30',
        cwd: ROOT,
      },
      seen.emit,
    );
    try {
      leader = await stdoutPid(seen.events);
      expect(mgr.cancel('snapshot-reuse', { keepLeftovers: true })).toBe(true);
      expect(sent).toEqual([]);
      process.kill(leader, 'SIGTERM');
      await done;
      mkdirSync(`${procRoot}/99994`);
      writeFileSync(
        `${procRoot}/99994/stat`,
        `99994 (unrelated) S 1 ${leader} ${leader} 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 999999 0 0\n`,
      );
      listing.resolve(['99994']);
      await new Promise((resolve) => setTimeout(resolve, 5_300));
      expect(sent).not.toContainEqual([-leader, 'SIGKILL']);
    } finally {
      listing.resolve([]);
      if (leader > 1 && isAlive(leader)) process.kill(leader, 'SIGKILL');
      await mgr.terminateAll();
      await done;
      rmSync(procRoot, { recursive: true, force: true });
    }
  }, 10_000);

  test('a tagged original survivor is reached when the leader exits during the rotation snapshot', async () => {
    const procRoot = mkdtempSync(`${tmpdir()}/runnerd-proc-`);
    const listing = Promise.withResolvers<string[]>();
    const sent: Array<[number, NodeJS.Signals]> = [];
    const mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      {
        procRoot,
        listDir: () => listing.promise,
        kill: (pid, signal) => {
          sent.push([pid, signal]);
        },
      },
      { execShim: null },
    );
    const seen = collect();
    let leader = 0;
    const done = mgr.run(
      {
        ...base,
        execId: 'snapshot-survivor',
        shell: 'echo $$; exec sleep 30',
        cwd: ROOT,
      },
      seen.emit,
    );
    try {
      leader = await stdoutPid(seen.events);
      expect(mgr.cancel('snapshot-survivor', { keepLeftovers: true })).toBe(
        true,
      );
      process.kill(leader, 'SIGTERM');
      await done;
      mkdirSync(`${procRoot}/99995`);
      writeFileSync(
        `${procRoot}/99995/stat`,
        `99995 (survivor) S 1 ${leader} ${leader} 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 55555 0 0\n`,
      );
      writeFileSync(
        `${procRoot}/99995/environ`,
        'TALE_EXEC_ID=snapshot-survivor\0',
      );
      listing.resolve(['99995']);
      await new Promise((resolve) => setTimeout(resolve, 5_300));
      expect(sent).toContainEqual([-leader, 'SIGTERM']);
      expect(sent).toContainEqual([-leader, 'SIGKILL']);
    } finally {
      listing.resolve([]);
      if (leader > 1 && isAlive(leader)) process.kill(leader, 'SIGKILL');
      await mgr.terminateAll();
      await done;
      rmSync(procRoot, { recursive: true, force: true });
    }
  }, 10_000);

  test('what a hand-over holds ends when no successor comes within its window', async () => {
    const procRoot = mkdtempSync(`${tmpdir()}/runnerd-proc-`);
    mkdirSync(`${procRoot}/99993`);
    writeFileSync(`${procRoot}/99993/environ`, 'TALE_EXEC_ID=eorphan\0');
    writeFileSync(
      `${procRoot}/99993/stat`,
      '99993 (server) S 1 99993 99993 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 4343 0 0\n',
    );
    const sent: Array<[number, NodeJS.Signals]> = [];
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      {
        procRoot,
        kill: (pid, signal) => {
          sent.push([pid, signal]);
          if (pid < 0) process.kill(pid, signal);
        },
      },
      // Found by its tag alone: no shim of the exec's is its ancestor here.
      { holdMaxMs: 400, execShim: null },
    );
    try {
      const done = mgr.run(
        { ...base, execId: 'eorphan', shell: 'sleep 30', cwd: ROOT },
        () => {},
      );
      while (mgr.status('eorphan')?.state !== 'running') {
        await new Promise((r) => setTimeout(r, 10));
      }
      // The restart that should follow never starts its exec.
      expect(mgr.cancel('eorphan', { keepLeftovers: true })).toBe(true);
      await done;
      expect(sent.some(([pid]) => pid === 99993)).toBe(false);
      const until = Date.now() + 3_000;
      while (!sent.some(([pid]) => pid === 99993) && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(sent).toContainEqual([99993, 'SIGTERM']);
      expect(mgr.leftoverCount()).toBe(0);
    } finally {
      rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test('a later cancel of an exec already handed over leaves what it holds to the successor', async () => {
    const procRoot = mkdtempSync(`${tmpdir()}/runnerd-proc-`);
    mkdirSync(`${procRoot}/99994`);
    writeFileSync(`${procRoot}/99994/environ`, 'TALE_EXEC_ID=elate\0');
    writeFileSync(
      `${procRoot}/99994/stat`,
      '99994 (server) S 1 99994 99994 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 4545 0 0\n',
    );
    const sent: Array<[number, NodeJS.Signals]> = [];
    // Found by its tag alone: no shim of the exec's is its ancestor here.
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      {
        procRoot,
        kill: (pid, signal) => {
          sent.push([pid, signal]);
          if (pid < 0) process.kill(pid, signal);
        },
      },
      { execShim: null },
    );
    let holder = 0;
    try {
      const { events, emit } = collect();
      // The child prints its own PID after ignoring SIGTERM, so cancellation
      // cannot race its trap setup. It keeps the pipes open after leader exit.
      const done = mgr.run(
        {
          ...base,
          execId: 'elate',
          shell: `sh -c 'trap "" TERM; echo $$; exec sleep 30' & exec sleep 30`,
          cwd: ROOT,
        },
        emit,
      );
      holder = await stdoutPid(events);
      expect(mgr.cancel('elate', { keepLeftovers: true })).toBe(true);
      await new Promise((r) => setTimeout(r, 300));
      expect(mgr.status('elate')?.state).toBe('running');
      // The superseded drive reaps the exec it no longer owns.
      expect(mgr.cancel('elate')).toBe(true);
      await new Promise((r) => setTimeout(r, 200));
      expect(sent.some(([pid]) => pid === 99994)).toBe(false);
      await done;
      await mgr.run(
        { ...base, execId: 'elate-next', command: ['true'], cwd: ROOT },
        () => {},
      );
      const until = Date.now() + 2_000;
      while (!sent.some(([pid]) => pid === 99994) && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(sent).toContainEqual([99994, 'SIGTERM']);
    } finally {
      if (holder > 1 && isAlive(holder)) process.kill(holder, 'SIGKILL');
      rmSync(procRoot, { recursive: true, force: true });
    }
  }, 15_000);

  test('a hold outlasts an exec that started before it', async () => {
    const procRoot = mkdtempSync(`${tmpdir()}/runnerd-proc-`);
    mkdirSync(`${procRoot}/99993`);
    writeFileSync(`${procRoot}/99993/environ`, 'TALE_EXEC_ID=ehold\0');
    writeFileSync(
      `${procRoot}/99993/stat`,
      '99993 (server) S 1 99993 99993 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 4444 0 0\n',
    );
    const sent: Array<[number, NodeJS.Signals]> = [];
    // Found by its tag alone: no shim of the exec's is its ancestor here.
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      {
        procRoot,
        kill: (pid, signal) => {
          sent.push([pid, signal]);
          if (pid < 0) process.kill(pid, signal);
        },
      },
      { execShim: null },
    );
    try {
      // Started before the hold: its end is no successor's.
      const earlier = mgr.run(
        { ...base, execId: 'ehold-earlier', shell: 'sleep 30', cwd: ROOT },
        () => {},
      );
      const done = mgr.run(
        { ...base, execId: 'ehold', shell: 'sleep 30', cwd: ROOT },
        () => {},
      );
      while (mgr.status('ehold')?.state !== 'running') {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(mgr.cancel('ehold', { keepLeftovers: true })).toBe(true);
      await done;
      expect(mgr.cancel('ehold-earlier')).toBe(true);
      await earlier;
      await new Promise((r) => setTimeout(r, 200));
      expect(sent.some(([pid]) => pid === 99993)).toBe(false);
      expect(mgr.leftoverCount()).toBe(1);
      // The daemon going down ends what is held too.
      await mgr.terminateAll();
      expect(sent).toContainEqual([99993, 'SIGTERM']);
    } finally {
      rmSync(procRoot, { recursive: true, force: true });
    }
  });

  test.skipIf(!existsSync('/proc/self/environ'))(
    'a server a turn started in a session of its own survives the turn’s rotation, until the next turn ends',
    async () => {
      using mgr = new ExecManager(new EnvStore(), () => {});
      const { events, emit } = collect();
      const done = mgr.run(
        {
          ...base,
          execId: 'erotreal',
          shell:
            'setsid /bin/sleep 407 >/dev/null 2>&1 </dev/null & sleep 0.2; pgrep -n -f "^/bin/sleep 407$"; exec sleep 30',
          cwd: ROOT,
        },
        emit,
      );
      const pid = await stdoutPid(events);
      expect(mgr.cancel('erotreal', { keepLeftovers: true })).toBe(true);
      await done;
      await new Promise((r) => setTimeout(r, 300));
      expect(isAlive(pid)).toBe(true);
      await mgr.run(
        { ...base, execId: 'erotreal-next', command: ['true'], cwd: ROOT },
        () => {},
      );
      await waitGone(pid);
      expect(isAlive(pid)).toBe(false);
    },
  );

  test('a daemon going down ends every live exec and what exited ones left', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    const done = mgr.run(
      {
        ...base,
        execId: 'edown',
        shell: 'sleep 30 & echo $!; wait',
        cwd: ROOT,
      },
      emit,
    );
    const pid = await stdoutPid(events);
    await mgr.terminateAll();
    await done;
    expect(events[events.length - 1]).toMatchObject({ t: 'exit' });
    await waitGone(pid);
    expect(isAlive(pid)).toBe(false);
  });

  test('a cancelled exec whose leader the scan cannot see still gets its SIGKILL', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    // A scrubbed environment carries no exec tag, and the leader ignores
    // SIGTERM: only the group SIGKILL ends it.
    const done = mgr.run(
      {
        ...base,
        timeoutMs: 30_000,
        execId: 'escrub',
        command: [
          'env',
          '-i',
          '/bin/sh',
          '-c',
          'trap "" TERM; echo up; exec sleep 30',
        ],
        cwd: ROOT,
      },
      emit,
    );
    const started = Date.now();
    while (!decode(events, 'stdout').includes('up')) {
      if (Date.now() - started > 5_000) throw new Error('escrub never started');
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(mgr.cancel('escrub')).toBe(true);
    await done;
    expect(Date.now() - started).toBeLessThan(9_000);
    expect(events[events.length - 1]).toMatchObject({
      t: 'exit',
      cancelled: true,
    });
    expect(mgr.liveCount()).toBe(0);
  }, 15_000);

  test('a leftover that writes output keeps its pipes while another exec runs', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const long = collect();
    const longDone = mgr.run(
      // This test needs an active peer, not its deadline; login-shell startup
      // and the output-drain grace can consume the default five-second budget.
      {
        ...base,
        timeoutMs: 30_000,
        execId: 'ewlong',
        shell: 'sleep 30',
        cwd: ROOT,
      },
      long.emit,
    );
    const short = collect();
    try {
      // A dev server logging to the stdout it inherited. Keep the control PID
      // on stderr: the background child's first tick can precede its parent's
      // echo, so the first stdout line is not guaranteed to be the PID.
      await mgr.run(
        {
          ...base,
          execId: 'ewshort',
          shell: '(while :; do echo tick; sleep 0.2; done) & echo $! >&2',
          cwd: ROOT,
        },
        short.emit,
      );
      const pid = Number(decode(short.events, 'stderr').trim());
      expect(pid).toBeGreaterThan(1);
      expect(decode(short.events, 'stdout')).toContain('tick');
      // Past the drain grace, its next lines must not hit a closed pipe.
      await new Promise((r) => setTimeout(r, 1_000));
      expect(isAlive(pid)).toBe(true);
      expect(mgr.cancel('ewlong')).toBe(true);
      await longDone;
      await waitGone(pid);
      expect(isAlive(pid)).toBe(false);
    } finally {
      await mgr.terminateAll();
      await longDone;
    }
  }, 15_000);

  test('a cancel during the drain of an exec whose leftovers wait ends them at once', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const long = collect();
    const longDone = mgr.run(
      { ...base, execId: 'edlong', shell: 'sleep 30', cwd: ROOT },
      long.emit,
    );
    const { events, emit } = collect();
    // The background sleep holds stdout, so the exec drains after its shell
    // exits, its leftovers waiting for the long exec.
    const done = mgr.run(
      { ...base, execId: 'edshort', shell: 'sleep 30 & echo $!', cwd: ROOT },
      emit,
    );
    const pid = await stdoutPid(events);
    await new Promise((r) => setTimeout(r, 200));
    expect(mgr.status('edshort')?.state).toBe('running');
    const cancelledAt = Date.now();
    expect(mgr.cancel('edshort')).toBe(true);
    await waitGone(pid);
    expect(isAlive(pid)).toBe(false);
    await done;
    expect(Date.now() - cancelledAt).toBeLessThan(1_500);
    expect(events[events.length - 1]).toMatchObject({
      t: 'exit',
      cancelled: true,
    });
    expect(mgr.cancel('edlong')).toBe(true);
    await longDone;
  }, 15_000);

  test('a daemon going down ends what exited execs left waiting, not only the live ones', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const long = collect();
    // Shrugs off SIGTERM: what it holds up must not wait for its SIGKILL.
    const longDone = mgr.run(
      {
        ...base,
        timeoutMs: 30_000,
        execId: 'etlong',
        shell: "trap '' TERM; echo up; sleep 30",
        cwd: ROOT,
      },
      long.emit,
    );
    const started = Date.now();
    while (!decode(long.events, 'stdout').includes('up')) {
      if (Date.now() - started > 5_000) throw new Error('etlong never started');
      await new Promise((r) => setTimeout(r, 10));
    }
    const short = collect();
    await mgr.run(
      {
        ...base,
        execId: 'etshort',
        shell: 'sleep 30 >/dev/null 2>&1 & echo $!',
        cwd: ROOT,
      },
      short.emit,
    );
    const pid = Number(decode(short.events, 'stdout').trim());
    expect(mgr.leftoverCount()).toBe(1);
    const downAt = Date.now();
    await mgr.terminateAll();
    await waitGone(pid);
    expect(isAlive(pid)).toBe(false);
    expect(Date.now() - downAt).toBeLessThan(2_500);
    // The long exec gets its SIGKILL after the grace.
    await longDone;
  }, 15_000);

  test('past 256 waiting leftovers, the ones with no process left are dropped', async () => {
    // A fake process table: only the exec `prune-7` still has a process.
    const procRoot = mkdtempSync(`${tmpdir()}/runnerd-proc-`);
    mkdirSync(`${procRoot}/99991`);
    writeFileSync(`${procRoot}/99991/environ`, 'TALE_EXEC_ID=prune-7\0');
    writeFileSync(
      `${procRoot}/99991/stat`,
      '99991 (dev) S 1 99991 99991 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 4242 0 0\n',
    );
    const sent: Array<[number, NodeJS.Signals]> = [];
    // Found by its tag alone: no shim of the exec's is its ancestor here.
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      undefined,
      {
        procRoot,
        // Real groups are the test's own execs; the fake pid is only recorded.
        kill: (pid, signal) => {
          sent.push([pid, signal]);
          if (pid < 0) process.kill(pid, signal);
        },
      },
      { execShim: null },
    );
    try {
      const long = collect();
      const longDone = mgr.run(
        {
          ...base,
          execId: 'prune-long',
          shell: 'sleep 120',
          timeoutMs: 60_000,
          cwd: ROOT,
        },
        long.emit,
      );
      while (mgr.status('prune-long')?.state !== 'running') {
        await new Promise((r) => setTimeout(r, 10));
      }
      for (let i = 0; i < 256; i += 1) {
        await mgr.run(
          { ...base, execId: `prune-${i}`, command: ['true'], cwd: ROOT },
          () => {},
        );
      }
      const started = Date.now();
      while (mgr.leftoverCount() > 1 && Date.now() - started < 5_000) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(mgr.leftoverCount()).toBe(1);
      // The one kept still gets its SIGTERM when the session's last exec ends.
      expect(mgr.cancel('prune-long')).toBe(true);
      await longDone;
      const until = Date.now() + 2_000;
      while (!sent.some(([pid]) => pid === 99991) && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(sent).toContainEqual([99991, 'SIGTERM']);
    } finally {
      rmSync(procRoot, { recursive: true, force: true });
    }
  }, 30_000);

  test('the primary consumer detaches without stopping the exec or its other subscribers', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const primary = collect();
    const controller = new AbortController();
    const done = mgr.run(
      {
        ...base,
        execId: 'primary-drop',
        command: ['cat'],
        cwd: ROOT,
        stdinMode: 'hold',
      },
      primary.emit,
      controller.signal,
    );
    const follower = collect();
    const attached = mgr.attach('primary-drop', follower.emit);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1);
    controller.abort();
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    const before = primary.events.length;
    expect(mgr.status('primary-drop')?.state).toBe('running');
    expect(
      mgr.writeStdin('primary-drop', {
        b64: Buffer.from('{"after":"disconnect"}\n').toString('base64'),
        eof: true,
      }),
    ).toEqual({ ok: true });
    await done;
    await attached;
    expect(primary.events).toHaveLength(before);
    expect(decode(follower.events, 'stdout')).toBe('{"after":"disconnect"}\n');
    expect(follower.events.at(-1)?.t).toBe('exit');
    const replay = collect();
    await mgr.attach('primary-drop', replay.emit);
    // The journal's catch-up marker records a different boundary for an
    // attach during execution versus one after exit. Recorded events match.
    expect(replay.events.filter((event) => event.seq !== undefined)).toEqual(
      follower.events.filter((event) => event.seq !== undefined),
    );
  });

  test('primary consumer abort listeners are removed on exit and spawn failure', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    for (const command of [['true'], [`${ROOT}/missing-command`]]) {
      const controller = new AbortController();
      await mgr.run(
        { ...base, execId: 'primary-cleanup', command, cwd: ROOT },
        () => {},
        controller.signal,
      );
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    }
  });

  test('a consumer that goes away stops following and settles its attach at once', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { emit } = collect();
    const done = mgr.run(
      { ...base, execId: 'edrop', shell: 'sleep 30', cwd: ROOT },
      emit,
    );
    const started = Date.now();
    while (mgr.status('edrop')?.state !== 'running') {
      if (Date.now() - started > 5_000) throw new Error('edrop never started');
      await new Promise((r) => setTimeout(r, 10));
    }
    const follower = collect();
    const consumer = new AbortController();
    const stream = mgr.attach('edrop', follower.emit, 0, consumer.signal);
    expect(stream).not.toBeNull();
    consumer.abort();
    const settled = await Promise.race([
      stream?.then(() => 'settled'),
      new Promise((r) => setTimeout(() => r('pending'), 500)),
    ]);
    expect(settled).toBe('settled');
    const seen = follower.events.length;
    expect(mgr.cancel('edrop')).toBe(true);
    await done;
    // The exit event went to the live consumer only, not to the one gone.
    expect(follower.events.length).toBe(seen);
  });

  test('repeated disconnected consumers leave no abort listeners or live subscriptions', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const done = mgr.run(
      { ...base, execId: 'ereconnect', shell: 'sleep 30', cwd: ROOT },
      () => {},
    );
    let followed = 0;
    try {
      for (let i = 0; i < 1000; i++) {
        const consumer = new AbortController();
        const stream = mgr.attach(
          'ereconnect',
          () => {
            followed++;
          },
          0,
          consumer.signal,
        );
        expect(stream).not.toBeNull();
        consumer.abort();
        await stream;
        expect(getEventListeners(consumer.signal, 'abort')).toHaveLength(0);
      }
      const replayed = followed;
      expect(mgr.cancel('ereconnect')).toBe(true);
      await done;
      expect(followed).toBe(replayed);
    } finally {
      mgr.cancel('ereconnect');
      await done;
    }
  });

  test('an exec finishing releases its attached consumers from their abort signals', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const done = mgr.run(
      { ...base, execId: 'eattachcleanup', shell: 'sleep 30', cwd: ROOT },
      () => {},
    );
    const consumers = Array.from({ length: 10 }, () => new AbortController());
    const streams = consumers.map((consumer) =>
      mgr.attach('eattachcleanup', () => {}, 0, consumer.signal),
    );
    // Handle every refusal immediately, before cancelling or yielding to the
    // process. Admission rejects two readers without attaching any listeners.
    const settled = Promise.allSettled(
      streams.map((stream) => Promise.resolve(stream)),
    );
    expect(streams.every((stream) => stream !== null)).toBe(true);
    expect(mgr.cancel('eattachcleanup')).toBe(true);
    await done;
    const outcomes = await settled;
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      ...Array.from({ length: 8 }, () => 'fulfilled' as const),
      'rejected',
      'rejected',
    ]);
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toMatchObject({
          message: 'attachment limit reached',
        });
      }
    }
    for (const consumer of consumers) {
      expect(getEventListeners(consumer.signal, 'abort')).toHaveLength(0);
    }
  });

  test('attach replays the journal of a just-finished exec', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { emit } = collect();
    await mgr.run(
      { ...base, execId: 'e10', command: ['echo', 'replay-me'], cwd: ROOT },
      emit,
    );
    // Exec already exited; attach replays from the retained journal.
    const replayed = collect();
    const stream = mgr.attach('e10', replayed.emit);
    expect(stream).not.toBeNull();
    await stream;
    expect(decode(replayed.events, 'stdout')).toBe('replay-me\n');
    expect(replayed.events[replayed.events.length - 1]?.t).toBe('exit');
  });

  test('attach to a live exec follows new events to exit', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { emit } = collect();
    const done = mgr.run(
      { ...base, execId: 'e11', shell: 'sleep 0.3; echo late', cwd: ROOT },
      emit,
    );
    await new Promise((r) => setTimeout(r, 80)); // attach mid-run
    const follower = collect();
    const stream = mgr.attach('e11', follower.emit);
    expect(stream).not.toBeNull();
    await Promise.all([done, stream]);
    // Follower saw the late stdout and the terminal exit.
    expect(decode(follower.events, 'stdout')).toContain('late');
    expect(follower.events[follower.events.length - 1]?.t).toBe('exit');
  });

  test('attach to an unknown exec returns null', () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    expect(mgr.attach('nope', () => {})).toBeNull();
  });

  test('assigns a monotonic seq to every emitted event', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    await mgr.run(
      { ...base, execId: 'eq1', command: ['echo', 'hi'], cwd: ROOT },
      emit,
    );
    const seqs = events.map((e) => e.seq);
    expect(seqs.every((s) => typeof s === 'number')).toBe(true);
    // strictly increasing from 1
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  test('attach(sinceSeq) replays only events newer than the cursor', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    await mgr.run(
      { ...base, execId: 'eq2', command: ['echo', 'replay-me'], cwd: ROOT },
      emit,
    );
    // Resume from the 2nd event — replay must skip seq 1 and 2.
    const cursor = events[1]?.seq ?? 0;
    expect(cursor).toBeGreaterThan(0);
    const replayed = collect();
    await mgr.attach('eq2', replayed.emit, cursor);
    expect(replayed.events.length).toBeGreaterThan(0);
    expect(
      replayed.events
        .filter((e) => e.t !== 'replay-start' && e.t !== 'replay-complete')
        .every((e) => (e.seq ?? 0) > cursor),
    ).toBe(true);
    // The full replay (cursor 0) returns strictly more events.
    const all = collect();
    await mgr.attach('eq2', all.emit, 0);
    expect(all.events.length).toBeGreaterThan(replayed.events.length);
  });

  test('replay rejects invalid or future cursors without suppressing the transcript', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    await mgr.run(
      { ...base, execId: 'invalid-cursor', command: ['true'], cwd: ROOT },
      () => {},
    );
    for (const cursor of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
    ]) {
      const output = collect();
      await mgr.attach('invalid-cursor', output.emit, cursor);
      expect(output.events).toEqual([
        {
          t: 'fail',
          code: 'REPLAY_UNAVAILABLE',
          message: 'Invalid execution replay cursor.',
        },
      ]);
    }
  });

  test('eight stalled replay readers bound admission and cancellation frees a slot', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    await mgr.run(
      { ...base, execId: 'reader-limit', command: ['true'], cwd: ROOT },
      () => {},
    );
    const controllers = Array.from({ length: 8 }, () => new AbortController());
    const pending = controllers.map((controller) =>
      mgr.attach(
        'reader-limit',
        () => new Promise<void>(() => {}),
        0,
        controller.signal,
      ),
    );
    const refused = collect();
    const extra = new AbortController();
    try {
      expect(mgr.hasAttachCapacity).toBe(false);
      const refusal = mgr
        .attach('reader-limit', refused.emit, 0, extra.signal)
        ?.catch((error: unknown) => error);
      // Baseline has no admission guard; abort prevents a hanging red test.
      extra.abort();
      expect(await refusal).toMatchObject({
        message: 'attachment limit reached',
      });
      expect(refused.events).toEqual([]);
      controllers[0]!.abort();
      await pending[0];
      expect(mgr.hasAttachCapacity).toBe(true);
      const accepted = collect();
      await mgr.attach('reader-limit', accepted.emit);
      expect(accepted.events.at(-1)?.t).toBe('exit');
    } finally {
      controllers.forEach((controller) => controller.abort());
      await Promise.all(pending.map((stream) => Promise.resolve(stream)));
    }
  });

  test('the complete protocol survives diagnostic ring rollover and keeps its cursor', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const original = collect();
    await mgr.run(
      {
        ...base,
        execId: 'journal-rollover',
        command: [
          process.execPath,
          '-e',
          "process.stdout.write('BEGIN\\n'+ 'x'.repeat(2*1024*1024)+'\\nEND\\n')",
        ],
        cwd: ROOT,
        stdoutMaxBytes: 0,
      },
      original.emit,
    );
    const replay = collect();
    await mgr.attach('journal-rollover', replay.emit);
    expect(decode(replay.events, 'stdout')).toBe(
      decode(original.events, 'stdout'),
    );
    expect(decode(replay.events, 'stdout')).toStartWith('BEGIN\n');
    expect(replay.events[0]).toEqual({ t: 'replay-start' });
    expect(replay.events.some((event) => event.t === 'replay-complete')).toBe(
      true,
    );
    expect(replay.events.at(-1)?.t).toBe('exit');
    const cursor = original.events[3]?.seq ?? 0;
    const resumed = collect();
    await mgr.attach('journal-rollover', resumed.emit, cursor);
    expect(
      resumed.events.filter(
        (event) => event.t !== 'replay-start' && event.t !== 'replay-complete',
      ),
    ).toEqual(
      original.events
        .filter(
          (event) =>
            event.t !== 'replay-start' && event.t !== 'replay-complete',
        )
        .filter((event) => (event.seq ?? 0) > cursor),
    );
  });

  test('a stalled journal writer pauses child output before queued buffers can grow', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    // Called below with the original JournalBudget receiver.
    // oxlint-disable-next-line typescript-eslint/unbound-method
    const reserve = JournalBudget.prototype.reserve;
    const stalled = spyOn(
      JournalBudget.prototype,
      'reserve',
    ).mockImplementation(async function (this: JournalBudget, bytes: number) {
      entered.resolve();
      await release.promise;
      return reserve.call(this, bytes);
    });
    using mgr = new ExecManager(new EnvStore(), () => {});
    let received = 0;
    const done = mgr.run(
      {
        ...base,
        execId: 'slow-journal',
        command: [
          process.execPath,
          '-e',
          "process.stdout.write('x'.repeat(2*1024*1024))",
        ],
        cwd: ROOT,
        stdoutMaxBytes: 0,
      },
      (event) => {
        if (event.t === 'stdout')
          received += Buffer.from(event.b64, 'base64').length;
      },
    );
    try {
      await entered.promise;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (received > 0) break;
        await Bun.sleep(10);
      }
      await Bun.sleep(100);
      expect(received).toBeGreaterThan(0);
      // Production Node emits pipe chunks up to 64 KiB; leave headroom for
      // host Bun's larger chunks while detecting an unbounded writer queue.
      expect(received).toBeLessThan(1024 * 1024);
      release.resolve();
      await done;
      expect(received).toBe(2 * 1024 * 1024);
    } finally {
      release.resolve();
      stalled.mockRestore();
      await done;
    }
  });

  test('an output limit is explicit and ends the writer, never a successful truncated replay', async () => {
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      () => {},
      {},
      { journalMaxBytes: 1024 },
    );
    const original = collect();
    await mgr.run(
      {
        ...base,
        execId: 'journal-limit',
        command: [
          process.execPath,
          '-e',
          "process.stdout.write('x'.repeat(65536));setInterval(()=>{},1000)",
        ],
        cwd: ROOT,
        stdoutMaxBytes: 0,
      },
      original.emit,
    );
    expect(
      original.events.some(
        (event) => event.t === 'fail' && event.code === 'OUTPUT_LIMIT',
      ),
    ).toBe(true);
    expect(mgr.status('journal-limit')).toEqual({
      state: 'exited',
      exitCode: -1,
    });
    const replay = collect();
    await mgr.attach('journal-limit', replay.emit);
    expect(replay.events).toMatchObject([
      { t: 'replay-start' },
      { t: 'fail', code: 'OUTPUT_LIMIT' },
    ]);
  });

  test('completed journals evict under the session budget without losing exit status', async () => {
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      () => {},
      {},
      { journalBudgetBytes: 10_000 },
    );
    for (const execId of ['budget-old', 'budget-new'])
      await mgr.run(
        {
          ...base,
          execId,
          command: [
            process.execPath,
            '-e',
            "process.stdout.write('x'.repeat(4096))",
          ],
          cwd: ROOT,
        },
        () => {},
      );
    const replay = collect();
    await mgr.attach('budget-old', replay.emit);
    expect(replay.events).toMatchObject([
      { t: 'replay-start' },
      { t: 'fail', code: 'REPLAY_UNAVAILABLE' },
    ]);
    expect(mgr.status('budget-old')).toEqual({ state: 'exited', exitCode: 0 });
    const newer = collect();
    await mgr.attach('budget-new', newer.emit);
    expect(decode(newer.events, 'stdout')).toHaveLength(4096);
  });

  test('disposing a completed manager closes its retained journal descriptor', async () => {
    const handles: unknown[] = [];
    const finish: (this: ExecJournal) => void = Reflect.get(
      ExecJournal.prototype,
      'finish',
    );
    const opened = spyOn(ExecJournal.prototype, 'finish').mockImplementation(
      function (this: ExecJournal) {
        handles.push(Reflect.get(this, 'ready'));
        finish.call(this);
      },
    );
    try {
      {
        using mgr = new ExecManager(new EnvStore(), () => {});
        await mgr.run(
          { ...base, execId: 'dispose-retained', command: ['true'], cwd: ROOT },
          () => {},
        );
        expect(mgr.canAttach('dispose-retained')).toBe(true);
      }
      expect(handles).toHaveLength(1);
      const file: unknown = await handles[0];
      if (typeof file !== 'object' || file === null)
        throw new Error('missing journal handle');
      const deadline = Date.now() + 5_000;
      while (Reflect.get(file, 'fd') !== -1 && Date.now() < deadline) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(Reflect.get(file, 'fd')).toBe(-1);
    } finally {
      opened.mockRestore();
    }
  });

  test('eviction closes a stalled replay descriptor before reusing its disk budget', async () => {
    const maxBytes = 40_000;
    const budget = new JournalBudget(maxBytes);
    const journals: ExecJournal[] = [];
    const handles: unknown[] = [];
    const replays: Promise<void>[] = [];
    const failures: string[] = [];
    const release = Promise.withResolvers<void>();
    let finished = 0;
    try {
      for (let index = 0; index < 8; index += 1) {
        const journal = new ExecJournal(
          budget,
          () => {},
          (code) => failures.push(code),
          maxBytes,
        );
        journals.push(journal);
        journal.append(
          `${JSON.stringify({ t: 'stdout', seq: 1, b64: 'x'.repeat(30_000) })}\n`,
        );
        await journal.drain();
        journal.finish();
        // Inspect the actual descriptors, not the budget's own counter: the
        // regression released accounting while an unlinked file remained open.
        const handle: unknown = await Reflect.get(journal, 'ready');
        handles.push(handle);
        const entered = Promise.withResolvers<void>();
        replays.push(
          journal
            .replay(async (event) => {
              if (event.t === 'stdout') {
                entered.resolve();
                await release.promise;
              }
            }, 0)
            .then(() => {
              finished += 1;
              return undefined;
            }),
        );
        await entered.promise;
        let physicalBytes = 0;
        for (const file of handles) {
          if (typeof file !== 'object' || file === null)
            throw new Error('missing journal handle');
          const fd: unknown = Reflect.get(file, 'fd');
          if (typeof fd !== 'number')
            throw new Error('missing journal descriptor');
          if (fd >= 0) physicalBytes += fstatSync(fd).size;
        }
        expect(physicalBytes).toBeLessThanOrEqual(maxBytes);
      }
      // Eviction, not an eventual socket timeout, released the old readers.
      expect(finished).toBe(7);
      expect(failures).toEqual([]);
    } finally {
      release.resolve();
      await Promise.all(journals.map((journal) => journal.dispose()));
      await Promise.all(replays);
    }
  });

  test('a journal open failure cannot report success from a fast command', async () => {
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      () => {},
      {},
      { journalDirectory: ROOT + '/missing-parent' },
    );
    const original = collect();
    await mgr.run(
      { ...base, execId: 'journal-disk-fail', command: ['true'], cwd: ROOT },
      original.emit,
    );
    expect(
      original.events.some(
        (event) => event.t === 'fail' && event.code === 'REPLAY_UNAVAILABLE',
      ),
    ).toBe(true);
    expect(
      original.events.some(
        (event) => event.t === 'exit' && event.exitCode === 0,
      ),
    ).toBe(false);
  });

  test('an orphaned exec (no re-attach) is reaped at its sliding deadline', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    // Short window, no attach → the deadline is the sole orphan reaper.
    await mgr.run(
      { ...base, execId: 'eg1', timeoutMs: 120, shell: 'sleep 30', cwd: ROOT },
      emit,
    );
    const last = events[events.length - 1];
    expect(last?.t).toBe('exit');
    if (last?.t === 'exit') expect(last.timedOut).toBe(true);
  });

  test('a re-attach slides the deadline forward (exec outlives its window)', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { emit } = collect();
    // Wide window: a loaded runner's 100ms sleep can overshoot a 150ms
    // deadline and reap the exec before attach. Wait until live first so
    // spawn delay does not eat the window.
    const windowMs = 3_000;
    const done = mgr.run(
      {
        ...base,
        execId: 'eg2',
        timeoutMs: windowMs,
        shell: 'sleep 30',
        cwd: ROOT,
      },
      emit,
    );
    const started = Date.now();
    while (mgr.status('eg2')?.state !== 'running') {
      if (Date.now() - started > 5_000) throw new Error('eg2 never started');
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => setTimeout(r, 600)); // into the window, far from the edge
    // Re-attach re-arms the deadline to now+window → NOT killed at the original.
    const follower = collect();
    const stream = mgr.attach('eg2', follower.emit, 0);
    expect(stream).not.toBeNull();
    await new Promise((r) => setTimeout(r, 2_600)); // past the original 3s
    expect(mgr.status('eg2')?.state).toBe('running'); // survived: the attach slid the deadline
    expect(mgr.cancel('eg2')).toBe(true); // clean up
    await Promise.all([done, stream]);
  });

  test('status() reports running, then exited with the real exit code, then gone', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { emit } = collect();
    const done = mgr.run(
      { ...base, execId: 'st1', shell: 'sleep 0.3; exit 3', cwd: ROOT },
      emit,
    );
    await new Promise((r) => setTimeout(r, 80));
    expect(mgr.status('st1')?.state).toBe('running');
    await done;
    const exited = mgr.status('st1');
    expect(exited?.state).toBe('exited');
    if (exited?.state === 'exited') expect(exited.exitCode).toBe(3);
    expect(mgr.status('never-existed')).toBeNull(); // gone
  });
});

describe('ExecManager output caps', () => {
  const BIG = 600_000;
  const payload = 'x'.repeat(BIG);

  // Capture console.warn around a body, restoring it even on throw, so the
  // truncation-warn assertions don't leak a patched console into other tests.
  async function withWarnCapture(body: () => Promise<void>): Promise<string[]> {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => {
      warns.push(a.map(String).join(' '));
    };
    try {
      await body();
    } finally {
      console.warn = orig;
    }
    return warns;
  }

  test('stdoutMaxBytes <= 0 ⇒ UNLIMITED: forwards past the old cap, never truncates', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    const warns = await withWarnCapture(() =>
      mgr.run(
        {
          ...base,
          execId: 'cap-unl',
          command: ['cat'],
          cwd: ROOT,
          stdoutMaxBytes: 0, // unlimited sentinel (the streaming-agent path)
          stdinBase64: Buffer.from(payload).toString('base64'),
        },
        emit,
      ),
    );
    expect(decode(events, 'stdout').length).toBe(BIG);
    const exit = events[events.length - 1];
    expect(exit?.t).toBe('exit');
    if (exit?.t === 'exit') expect(exit.truncated.stdout).toBe(false);
    expect(warns.filter((w) => w.includes('hit cap')).length).toBe(0);
  });

  test('a positive stdoutMaxBytes still truncates and warns exactly once per exec', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    const warns = await withWarnCapture(() =>
      mgr.run(
        {
          ...base,
          execId: 'cap-trunc',
          command: ['cat'],
          cwd: ROOT,
          stdoutMaxBytes: 100, // tiny cap → truncates after the first chunk
          stdinBase64: Buffer.from(payload).toString('base64'),
        },
        emit,
      ),
    );
    expect(decode(events, 'stdout').length).toBeLessThan(BIG);
    const exit = events[events.length - 1];
    expect(exit?.t).toBe('exit');
    if (exit?.t === 'exit') expect(exit.truncated.stdout).toBe(true);
    // Per-exec one-time: many chunks are dropped, but the warn fires once.
    expect(warns.filter((w) => w.includes('stdout hit cap')).length).toBe(1);
  });

  test('a cap-crossing chunk is clipped to exactly the cap (no overshoot)', async () => {
    // Regression: the old check tested `bytes >= cap` BEFORE adding the chunk,
    // so the first chunk (a 64KB pipe buffer) was emitted in full — overshooting
    // a 100B cap by ~640x. The fix clips the crossing chunk to the remaining
    // budget, so total emitted output is EXACTLY the cap, never more.
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    await withWarnCapture(() =>
      mgr.run(
        {
          ...base,
          execId: 'cap-exact',
          command: ['cat'],
          cwd: ROOT,
          stdoutMaxBytes: 100,
          stdinBase64: Buffer.from(payload).toString('base64'),
        },
        emit,
      ),
    );
    expect(decode(events, 'stdout').length).toBe(100);
    const exit = events[events.length - 1];
    if (exit?.t === 'exit') expect(exit.truncated.stdout).toBe(true);
  });

  test('stderr honors the same unlimited sentinel and one-time truncation warn', async () => {
    using unlMgr = new ExecManager(new EnvStore(), () => {});
    const unl = collect();
    await unlMgr.run(
      {
        ...base,
        execId: 'err-unl',
        shell: `head -c ${BIG} /dev/zero 1>&2`,
        cwd: ROOT,
        stderrMaxBytes: 0,
      },
      unl.emit,
    );
    expect(decode(unl.events, 'stderr').length).toBe(BIG);
    const unlExit = unl.events[unl.events.length - 1];
    if (unlExit?.t === 'exit') expect(unlExit.truncated.stderr).toBe(false);

    using capMgr = new ExecManager(new EnvStore(), () => {});
    const cap = collect();
    const warns = await withWarnCapture(() =>
      capMgr.run(
        {
          ...base,
          execId: 'err-trunc',
          shell: `head -c ${BIG} /dev/zero 1>&2`,
          cwd: ROOT,
          stderrMaxBytes: 100,
        },
        cap.emit,
      ),
    );
    const capExit = cap.events[cap.events.length - 1];
    if (capExit?.t === 'exit') expect(capExit.truncated.stderr).toBe(true);
    expect(warns.filter((w) => w.includes('stderr hit cap')).length).toBe(1);
  });
});

describe('ExecManager stdinMode hold + writeStdin', () => {
  const line = (obj: unknown) =>
    Buffer.from(`${JSON.stringify(obj)}\n`).toString('base64');

  test('hold: initial payload + appended lines reach the child; eof exits', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    const done = mgr.run(
      {
        ...base,
        execId: 'h1',
        command: ['cat'],
        cwd: ROOT,
        stdinMode: 'hold',
        stdinBase64: line({ n: 1 }),
      },
      emit,
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(mgr.writeStdin('h1', { b64: line({ n: 2 }) })).toEqual({
      ok: true,
    });
    expect(mgr.writeStdin('h1', { eof: true })).toEqual({ ok: true });
    await done;
    expect(decode(events, 'stdout')).toBe('{"n":1}\n{"n":2}\n');
    expect(events[events.length - 1]).toMatchObject({ t: 'exit', exitCode: 0 });
  });

  test('write after eof reports STDIN_CLOSED; after exit reports NOT_FOUND', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { emit } = collect();
    const done = mgr.run(
      { ...base, execId: 'h2', command: ['cat'], cwd: ROOT, stdinMode: 'hold' },
      emit,
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(mgr.writeStdin('h2', { eof: true })).toEqual({ ok: true });
    expect(mgr.writeStdin('h2', { b64: line({ late: true }) })).toEqual({
      ok: false,
      reason: 'STDIN_CLOSED',
    });
    await done;
    expect(mgr.writeStdin('h2', { b64: line({}) })).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });

  // The real broken-pipe-while-live path (a dead child whose pipe EPIPEs
  // asynchronously) only surfaces under Node, the production runtime — Bun's
  // test harness never raises EPIPE on a child stdin write, so it can't drive
  // that scenario through a real process. The writability predicate writeStdin
  // uses to refuse such a write is unit-tested directly instead.
  test('isStdinWritable refuses an ended/destroyed/errored stream (the broken-pipe guard)', () => {
    const live = new PassThrough();
    expect(isStdinWritable(live)).toBe(true);

    const ended = new PassThrough();
    ended.end();
    expect(isStdinWritable(ended)).toBe(false);

    const destroyed = new PassThrough();
    destroyed.destroy();
    expect(isStdinWritable(destroyed)).toBe(false);

    const errored = new PassThrough();
    errored.on('error', () => {}); // avoid an unhandled 'error' throw
    errored.destroy(new Error('EPIPE'));
    expect(isStdinWritable(errored)).toBe(false);
  });

  test('close-mode exec refuses writes (legacy semantics unchanged)', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    const done = mgr.run(
      { ...base, execId: 'h3', shell: 'sleep 5', cwd: ROOT },
      emit,
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(mgr.writeStdin('h3', { b64: line({}) })).toEqual({
      ok: false,
      reason: 'STDIN_CLOSED',
    });
    mgr.cancel('h3');
    await done;
    expect(events[events.length - 1]).toMatchObject({
      t: 'exit',
      cancelled: true,
    });
  });

  test('BAD_LINE: missing newline, interior newline, invalid JSON, oversized', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { emit } = collect();
    const done = mgr.run(
      { ...base, execId: 'h4', command: ['cat'], cwd: ROOT, stdinMode: 'hold' },
      emit,
    );
    await new Promise((r) => setTimeout(r, 100));
    const bad = (raw: string) => Buffer.from(raw).toString('base64');
    expect(mgr.writeStdin('h4', { b64: bad('{"a":1}') })).toEqual({
      ok: false,
      reason: 'BAD_LINE',
    });
    expect(mgr.writeStdin('h4', { b64: bad('{"a":\n1}\n') })).toEqual({
      ok: false,
      reason: 'BAD_LINE',
    });
    expect(mgr.writeStdin('h4', { b64: bad('{not json\n') })).toEqual({
      ok: false,
      reason: 'BAD_LINE',
    });
    const huge = `${JSON.stringify({ pad: 'x'.repeat(70 * 1024) })}\n`;
    expect(mgr.writeStdin('h4', { b64: bad(huge) })).toEqual({
      ok: false,
      reason: 'BAD_LINE',
    });
    // The exec is unharmed by rejected writes.
    expect(mgr.writeStdin('h4', { eof: true })).toEqual({ ok: true });
    await done;
  });

  test('cancel while stdin held cleans up (no wedge, cancelled exit)', async () => {
    using mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    const done = mgr.run(
      { ...base, execId: 'h5', command: ['cat'], cwd: ROOT, stdinMode: 'hold' },
      emit,
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(mgr.cancel('h5')).toBe(true);
    await done;
    expect(events[events.length - 1]).toMatchObject({
      t: 'exit',
      cancelled: true,
    });
    expect(mgr.writeStdin('h5', { eof: true })).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });
});
