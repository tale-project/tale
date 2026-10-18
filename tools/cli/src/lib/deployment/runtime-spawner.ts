import { z } from 'zod';

import { externalDepError } from '../../utils/fail';
import { runtimeCommand, runtimeSleep } from './runtime-command';
import { requireRuntime, type RuntimeDependencies } from './runtime-model';

/** How long a drained spawner is given to end its sessions, and how often it
 * is asked. A spawner stops sessions that outlast its linger by itself, so a
 * longer wait belongs to a later attempt. */
const DRAIN_BUDGET_MS = 300_000;
const DRAIN_READS = 60;
const DRAIN_STEP_MS = 5000;

/** Parse a bounded JSON answer of the spawner's control CLI or readers. */
export function spawnerJson(text: string): unknown {
  requireRuntime(text.length <= 100_000, 'Spawner response is oversized.');
  try {
    return JSON.parse(text);
  } catch {
    throw externalDepError('Spawner returned invalid JSON.');
  }
}

async function control(
  containerId: string,
  command: 'drain' | 'drain-status',
  dependencies: RuntimeDependencies,
) {
  const result = await runtimeCommand(
    [
      'exec',
      containerId,
      'timeout',
      '15',
      'bun',
      '/app/src/control-cli.ts',
      command,
    ],
    dependencies,
    { timeout: 20 },
  );
  return spawnerJson(result.stdout);
}

/** The spawner's drain state and the sessions it still holds, in the exact
 * shape its control CLI answers. */
export async function spawnerStatus(
  containerId: string,
  dependencies: RuntimeDependencies,
) {
  const result = z
    .strictObject({
      draining: z.boolean(),
      sessions: z.number().int().nonnegative(),
      sessionIds: z.array(z.string().min(1).max(128)).max(10000),
    })
    .parse(await control(containerId, 'drain-status', dependencies));
  requireRuntime(
    result.sessions === result.sessionIds.length &&
      new Set(result.sessionIds).size === result.sessions,
    'Spawner drain status is inconsistent.',
  );
  return result;
}

/**
 * Latch the spawner's drain (one way: new sessions are refused, the existing
 * ones are still served) and read its status until it holds no session or the
 * budget is used up. `sessions` is the last count read, `null` when no read
 * completed. Nothing is stopped or deleted here.
 */
export async function drainSpawner(
  containerId: string,
  dependencies: RuntimeDependencies,
): Promise<{ drained: boolean; sessions: number | null }> {
  z.strictObject({ draining: z.literal(true) }).parse(
    await control(containerId, 'drain', dependencies),
  );
  let sessions: number | null = null;
  const deadline = performance.now() + DRAIN_BUDGET_MS;
  for (let attempt = 0; attempt < DRAIN_READS; attempt++) {
    if (performance.now() >= deadline) break;
    const observed = await spawnerStatus(containerId, dependencies);
    requireRuntime(
      observed.draining,
      'Spawner did not retain its drain latch.',
    );
    sessions = observed.sessions;
    if (observed.sessions === 0) return { drained: true, sessions };
    if (attempt !== DRAIN_READS - 1 && performance.now() < deadline)
      await runtimeSleep(
        dependencies,
        Math.min(DRAIN_STEP_MS, deadline - performance.now()),
      );
  }
  return { drained: false, sessions };
}
