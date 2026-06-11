// runnerd exec-manager unit tests. No container needed — these run the host's
// real /bin processes through the manager and assert the NDJSON event shapes,
// cwd validation, dedup, and timeout/cancel. TALE_WORKSPACE_ROOT points the
// cwd-safety check at a temp dir so the happy path is hermetic.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { EnvStore } from './env-store.ts';
import { ExecManager } from './exec-manager.ts';
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
});
