// runnerd exec-manager unit tests. No container needed — these run the host's
// real /bin processes through the manager and assert the NDJSON event shapes,
// cwd validation, dedup, and timeout/cancel. TALE_WORKSPACE_ROOT points the
// cwd-safety check at a temp dir so the happy path is hermetic.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';

import { EnvStore } from './env-store.ts';
import { ExecManager, isStdinWritable } from './exec-manager.ts';
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
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
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

  test('exit durationMs is the runner-measured process wall-clock (spawn → drained exit)', async () => {
    const mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    const beforeMs = Date.now();
    await mgr.run(
      { ...base, execId: 'dur1', shell: 'sleep 0.12', cwd: ROOT },
      emit,
    );
    const afterMs = Date.now();
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
    // Date.now() granularity slack) and never exceeds the outer wall-clock —
    // i.e. it contains NO out-of-process phase (staging, harvest, scheduling).
    expect(exit.durationMs).toBeGreaterThanOrEqual(110);
    expect(exit.durationMs).toBeLessThanOrEqual(afterMs - start.startedAtMs);
  });

  test('shell form runs via bash -lc, propagates non-zero exit', async () => {
    const mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    await mgr.run({ ...base, execId: 'e2', shell: 'exit 3', cwd: ROOT }, emit);
    expect(events[events.length - 1]).toMatchObject({ t: 'exit', exitCode: 3 });
  });

  test('per-exec env overlay reaches the child; deny-list blocked', async () => {
    const mgr = new ExecManager(
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
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    await mgr.run(
      { ...base, execId: 'e5', command: ['echo', 'x'], cwd: '/etc' },
      emit,
    );
    expect(events[0]).toMatchObject({ t: 'fail', code: 'INVALID_CWD' });
  });

  test('rejects when neither/both of command and shell given', async () => {
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
    const { events, emit } = collect();
    await mgr.run(
      { ...base, execId: 'bad id!', command: ['echo', 'x'], cwd: ROOT },
      emit,
    );
    expect(events[0]).toMatchObject({ t: 'fail', code: 'BAD_REQUEST' });
  });

  test('timeout kills the process group and flags timedOut', async () => {
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
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

  test('attach replays the ring of a just-finished exec', async () => {
    const mgr = new ExecManager(new EnvStore(), () => {});
    const { emit } = collect();
    await mgr.run(
      { ...base, execId: 'e10', command: ['echo', 'replay-me'], cwd: ROOT },
      emit,
    );
    // Exec already exited; attach replays from the retained ring.
    const replayed = collect();
    const stream = mgr.attach('e10', replayed.emit);
    expect(stream).not.toBeNull();
    await stream;
    expect(decode(replayed.events, 'stdout')).toBe('replay-me\n');
    expect(replayed.events[replayed.events.length - 1]?.t).toBe('exit');
  });

  test('attach to a live exec follows new events to exit', async () => {
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
    expect(mgr.attach('nope', () => {})).toBeNull();
  });

  test('assigns a monotonic seq to every emitted event', async () => {
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    expect(replayed.events.every((e) => (e.seq ?? 0) > cursor)).toBe(true);
    // The full replay (cursor 0) returns strictly more events.
    const all = collect();
    await mgr.attach('eq2', all.emit, 0);
    expect(all.events.length).toBeGreaterThan(replayed.events.length);
  });

  test('an orphaned exec (no re-attach) is reaped at its sliding deadline', async () => {
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const unlMgr = new ExecManager(new EnvStore(), () => {});
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

    const capMgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
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
    const mgr = new ExecManager(new EnvStore(), () => {});
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
