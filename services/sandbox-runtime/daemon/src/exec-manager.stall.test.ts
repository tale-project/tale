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

  test('an exec whose command exited is not ended as stalled while it drains', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    // No round samples before the command printed its last line, the moment
    // before it exits: the watch can judge it only while its output drains.
    const watch = idleWatch(300);
    let sampling = false;
    const rounds: number[] = [];
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      () => {},
      {},
      {
        stall: {
          ...watch.stall,
          readTable: async () => {
            if (!sampling) return null;
            rounds.push(Date.now());
            return [];
          },
        },
      },
    );
    // While another exec runs, what this one leaves running waits for it and
    // holds the exec's stdout open: the drain lasts its whole grace.
    const busyDone = mgr.run(
      {
        ...base,
        execId: 'stall4busy',
        shell: 'while :; do echo tick; sleep 0.05; done',
      },
      () => {},
    );
    try {
      const events: RunnerdExecEvent[] = [];
      let lastOutputAt = 0;
      let exitAt = 0;
      await mgr.run(
        { ...base, execId: 'stall4', shell: 'sleep 30 & echo $!; exit 3' },
        (e) => {
          events.push(e);
          if (e.t === 'stdout' && !sampling) {
            lastOutputAt = Date.now();
            sampling = true;
          }
          if (e.t === 'exit') exitAt = Date.now();
        },
      );
      const exit = events.at(-1);
      expect(exit?.t).toBe('exit');
      if (exit?.t !== 'exit') return;
      expect(exit.exitCode).toBe(3);
      expect(exit.failure).toBeUndefined();
      // Rounds ran a whole window past its last output and before its exit:
      // the watch judged it quiet and idle inside the drain.
      const judgedFrom = lastOutputAt + 2 * watch.stall.windowMs;
      expect(rounds.some((at) => at >= judgedFrom && at < exitAt)).toBe(true);
      expect(
        warn.mock.calls.some((call) =>
          String(call[0]).includes('ending it as stalled'),
        ),
      ).toBe(false);
    } finally {
      mgr.cancel('stall4busy');
      await busyDone;
      warn.mockRestore();
    }
  }, 15_000);
});

describe('ExecManager OOM attribution', () => {
  /** A session whose OOM-kill count reads `counts` in turn (the last one
   * from then on) and whose memory peak is 512 MiB. */
  function memory(counts: number[]) {
    let read = 0;
    return {
      memory: {
        oomKills: async () =>
          counts[Math.min(read++, counts.length - 1)] ?? null,
        peak: async () => 512 * 1_048_576,
      },
      ...idleWatch(0),
    };
  }

  async function exitOf(
    mgr: ExecManager,
    execId: string,
    shell: string,
  ): Promise<Extract<RunnerdExecEvent, { t: 'exit' }> | undefined> {
    const events: RunnerdExecEvent[] = [];
    await mgr.run({ ...base, execId, shell }, (e) => events.push(e));
    const exit = events.at(-1);
    return exit?.t === 'exit' ? exit : undefined;
  }

  test('a SIGKILL while the session counted a new OOM kill is the OOM killer', async () => {
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      () => {},
      {},
      memory([4, 5]),
    );
    const exit = await exitOf(mgr, 'oom1', 'kill -9 $$');
    expect(exit?.exitCode).toBe(137);
    expect(exit?.oomKilled).toBe(true);
    expect(exit?.sessionMemoryPeakBytes).toBe(512 * 1_048_576);
  });

  test('a SIGKILL with no new OOM kill is no OOM', async () => {
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      () => {},
      {},
      memory([4, 4]),
    );
    const exit = await exitOf(mgr, 'oom2', 'kill -9 $$');
    expect(exit?.exitCode).toBe(137);
    expect(exit?.oomKilled).toBeUndefined();
  });

  test("another process's OOM kill does not make a plain failure an OOM", async () => {
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      () => {},
      {},
      memory([4, 5]),
    );
    const exit = await exitOf(mgr, 'oom3', 'exit 1');
    expect(exit?.exitCode).toBe(1);
    expect(exit?.oomKilled).toBeUndefined();
  });

  test('a session whose OOM kills cannot be read judges none', async () => {
    using mgr = new ExecManager(
      new EnvStore(),
      () => {},
      () => {},
      {},
      {
        memory: { oomKills: async () => null, peak: async () => null },
        ...idleWatch(0),
      },
    );
    const exit = await exitOf(mgr, 'oom4', 'kill -9 $$');
    expect(exit?.oomKilled).toBeUndefined();
    expect(exit?.sessionMemoryPeakBytes).toBeUndefined();
  });
});
