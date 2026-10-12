// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createShutdownState } from './lib/shutdown.ts';
import {
  runShutdownSequence,
  shouldDeferJobs,
  shutdownDrainMs,
  shutdownGraceMs,
  type ShutdownSteps,
} from './shutdown-sequence.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Steps that record the order they ran in. `stopBoss` resolves only when
 * the test lets it, so the sequence's other steps run while it stops. */
function recordingSteps(
  role: ShutdownSteps['role'],
  overrides: Partial<ShutdownSteps> = {},
) {
  const calls: string[] = [];
  let finishStop: () => void = () => {};
  const shutdown = createShutdownState();
  const steps: ShutdownSteps = {
    role,
    drainMs: 90_000,
    shutdown,
    closeServer: async () => {
      calls.push(`server (shutting down: ${shutdown.shuttingDown})`);
    },
    stopBoss: (options) => {
      calls.push(`boss.stop ${options.timeout}`);
      return new Promise<void>((resolve) => {
        finishStop = () => {
          calls.push('boss stopped');
          resolve();
        };
      });
    },
    settleLiveTurns: async (timeoutMs) => {
      calls.push(`settle ${timeoutMs}`);
      // The jobs still running stop only after the turns handed on.
      finishStop();
      return 0;
    },
    releaseOwnedRunLeases: async () => {
      calls.push('release');
      return 0;
    },
    settleChatTurns: async (timeoutMs) => {
      calls.push(`chat ${timeoutMs}`);
      return 0;
    },
    closeStores: async () => {
      calls.push('stores');
    },
    // A clock that stands still: the budget a step gets is the whole of it.
    now: () => 0,
    ...overrides,
  };
  return { calls, steps, shutdown, finish: () => finishStop() };
}

describe('the shutdown sequence', () => {
  it('tells the work first, then hands runs on before waiting out the other jobs', async () => {
    // The job stop finishes only inside `settle`: a sequence that awaited
    // it before handing its runs on would never get there.
    const { calls, steps, shutdown } = recordingSteps('all');

    await runShutdownSequence('SIGTERM', steps);

    expect(shutdown.shuttingDown).toBe(true);
    expect(calls).toEqual([
      'server (shutting down: true)',
      'boss.stop 90000',
      'settle 30000',
      'boss stopped',
      'release',
      'chat 90000',
      'stores',
    ]);
  });

  it('runs no automation steps on the api role', async () => {
    const { calls, steps, finish } = recordingSteps('api', {
      drainMs: 15_000,
    });

    const done = runShutdownSequence('SIGTERM', steps);
    await vi.waitFor(() => expect(calls).toContain('boss.stop 15000'));
    finish();
    await done;

    expect(calls).toEqual([
      'server (shutting down: true)',
      'boss.stop 15000',
      'boss stopped',
      'chat 15000',
      'stores',
    ]);
  });

  it('still releases runs and closes the stores when a step fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { calls, steps, finish } = recordingSteps('worker', {
      closeServer: null,
      settleLiveTurns: async () => {
        finish();
        throw new Error('registry gone');
      },
      releaseOwnedRunLeases: async () => {
        calls.push('release');
        throw new Error('database closing');
      },
    });

    await runShutdownSequence('SIGTERM', steps);

    expect(calls).toEqual([
      'boss.stop 90000',
      'boss stopped',
      'release',
      'chat 90000',
      'stores',
    ]);
    expect(error).toHaveBeenCalledWith(
      '[backend] could not hand automation runs on:',
      expect.any(Error),
    );
  });
});

describe('the chat turns a stopping process is still running', () => {
  it('get what is left of the drain budget once the server and the jobs are done', async () => {
    let clock = 1_000;
    const { calls, steps, finish } = recordingSteps('api', {
      drainMs: 15_000,
      now: () => clock,
      // The HTTP close took five seconds of the fifteen.
      closeServer: async () => {
        clock += 5_000;
      },
    });

    const done = runShutdownSequence('SIGTERM', steps);
    await vi.waitFor(() => expect(calls).toContain('boss.stop 15000'));
    finish();
    await done;

    expect(calls).toContain('chat 10000');
  });

  it('get nothing more once a worker has used its whole budget on its jobs', async () => {
    let clock = 0;
    const { calls, steps, finish } = recordingSteps('worker', {
      now: () => clock,
      settleLiveTurns: async () => {
        clock += 95_000;
        finish();
        return 0;
      },
    });

    await runShutdownSequence('SIGTERM', steps);

    // Past the budget: the turns still running are settled at once.
    expect(calls).toContain('chat 0');
  });

  it('are settled before the stores close, and say so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { calls, steps, finish } = recordingSteps('api', {
      drainMs: 15_000,
      settleChatTurns: async () => {
        calls.push('chat settled');
        return 3;
      },
    });

    const done = runShutdownSequence('SIGTERM', steps);
    await vi.waitFor(() => expect(calls).toContain('boss.stop 15000'));
    finish();
    await done;

    expect(calls.slice(-2)).toEqual(['chat settled', 'stores']);
    expect(warn).toHaveBeenCalledWith(
      '[backend] 3 chat turn(s) still running at shutdown — settled as interrupted',
    );
  });

  it('never keep the stores open when settling them fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { calls, steps, finish } = recordingSteps('api', {
      drainMs: 15_000,
      settleChatTurns: async () => {
        throw new Error('database closing');
      },
    });

    const done = runShutdownSequence('SIGTERM', steps);
    await vi.waitFor(() => expect(calls).toContain('boss.stop 15000'));
    finish();
    await done;

    expect(calls.at(-1)).toBe('stores');
    expect(warn).toHaveBeenCalledWith(
      '[backend] could not settle the running chat turns:',
      expect.any(Error),
    );
  });
});

describe('the stop budget', () => {
  it('defaults per role, and SHUTDOWN_DRAIN_MS overrides it', () => {
    expect(shutdownDrainMs({ ROLE: 'api' })).toBe(15_000);
    expect(shutdownDrainMs({ ROLE: 'worker' })).toBe(90_000);
    expect(shutdownDrainMs({ ROLE: 'all' })).toBe(90_000);
    expect(shutdownDrainMs({ ROLE: 'worker', SHUTDOWN_DRAIN_MS: 30_000 })).toBe(
      30_000,
    );
  });

  it('gives a step 20 s, or a third of a shorter budget', () => {
    expect(shutdownGraceMs(90_000)).toBe(20_000);
    expect(shutdownGraceMs(30_000)).toBe(10_000);
    expect(shutdownGraceMs(1_000)).toBe(333);
  });
});

describe('a job a stopping worker fetched', () => {
  it('is handed over unstarted once shutdown has begun, without reading the drain', async () => {
    const shutdown = createShutdownState();
    const draining = vi.fn(async () => false);
    const defer = shouldDeferJobs(shutdown, draining);

    expect(await defer()).toBe(false);
    shutdown.begin('SIGTERM', 20_000);
    expect(await defer()).toBe(true);
    expect(draining).toHaveBeenCalledTimes(1);
  });

  it('is handed over while the replica is drained', async () => {
    const defer = shouldDeferJobs(createShutdownState(), async () => true);
    expect(await defer()).toBe(true);
  });
});
