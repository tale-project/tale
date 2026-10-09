// The stall watch inside the exec manager: an exec that prints nothing and
// computes nothing for the whole window ends through the cancel path, and
// its exit event says why. The process table is faked — empty, so the exec
// reads as idle — while the exec itself is a real process on this host.

import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { EnvStore } from './env-store.ts';
import { ExecManager } from './exec-manager.ts';
import type { RunnerdExecEvent } from './protocol.ts';

const ROOT = realpathSync(mkdtempSync(`${tmpdir()}/runnerd-stall-`));

beforeAll(() => {
  process.env.TALE_WORKSPACE_ROOT = ROOT;
});
afterAll(() => {
  delete process.env.TALE_WORKSPACE_ROOT;
  rmSync(ROOT, { recursive: true, force: true });
});

const base = {
  timeoutMs: 30_000,
  stdoutMaxBytes: 1_000_000,
  stderrMaxBytes: 1_000_000,
  cwd: ROOT,
};

function idleWatch(windowMs: number) {
  return {
    stall: {
      windowMs,
      sampleMs: 20,
      readTable: async () => [],
      readEngineUsec: async () => null,
    },
  };
}

describe('ExecManager stall watch', () => {
  test('ends a quiet, idle exec and says so on its exit event', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      using mgr = new ExecManager(
        new EnvStore(),
        () => {},
        () => {},
        {},
        idleWatch(200),
      );
      const events: RunnerdExecEvent[] = [];
      const started = Date.now();
      await mgr.run({ ...base, execId: 'stall1', shell: 'sleep 30' }, (e) =>
        events.push(e),
      );
      const exit = events.at(-1);
      expect(exit?.t).toBe('exit');
      if (exit?.t !== 'exit') return;
      expect(exit.failure).toBe('EXEC_STALLED');
      expect(exit.cancelled).toBe(false);
      expect(exit.timedOut).toBe(false);
      expect(exit.exitCode).not.toBe(0);
      // Ended by the watch, long before its own 30 s.
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(
        warn.mock.calls.some((call) =>
          String(call[0]).includes('ending it as stalled'),
        ),
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  test('an exec that ends by itself carries no failure', async () => {
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      () => {},
      {},
      idleWatch(60_000),
    );
    const events: RunnerdExecEvent[] = [];
    await mgr.run({ ...base, execId: 'stall2', shell: 'exit 3' }, (e) =>
      events.push(e),
    );
    const exit = events.at(-1);
    expect(exit?.t).toBe('exit');
    if (exit?.t !== 'exit') return;
    expect(exit.exitCode).toBe(3);
    expect(exit.failure).toBeUndefined();
  });

  test('a window of 0 never ends an exec', async () => {
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      () => {},
      {},
      idleWatch(0),
    );
    const events: RunnerdExecEvent[] = [];
    const done = mgr.run(
      { ...base, execId: 'stall3', shell: 'sleep 30' },
      (e) => events.push(e),
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(mgr.liveCount()).toBe(1);
    expect(mgr.cancel('stall3')).toBe(true);
    await done;
    const exit = events.at(-1);
    expect(exit?.t === 'exit' && exit.failure).toBeUndefined();
    expect(exit?.t === 'exit' && exit.cancelled).toBe(true);
  });
});
