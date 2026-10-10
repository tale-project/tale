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
    closeStores: async () => {
      calls.push('stores');
    },
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
      'stores',
    ]);
    expect(error).toHaveBeenCalledWith(
      '[backend] could not hand automation runs on:',
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
