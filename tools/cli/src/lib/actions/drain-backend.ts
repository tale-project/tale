/**
 * Deploy DRAIN orchestration for the 0.5 Postgres backend tier.
 *
 * The pg backend (`backend-api` / `backend-worker`) rolls in place on every
 * deploy, and the recreate would cut in-flight chat generations. `drainBackend` tells the api container to refuse NEW turns
 * (the client retries onto the restart — see the chat send route's 503) and
 * waits for in-flight generations to finish; `endDrainBackend` clears the
 * flag once the tier is healthy again.
 *
 * The control channel is the shared `controlCall` (docker/control-call.ts) —
 * the same shape as the sandbox tier's drain (drain-sandbox.ts).
 *
 * Best-effort by design: an older backend without the door, a tier that isn't
 * running, or any transient error skips the drain and proceeds — the recovery
 * watchdog finalizes whatever the recreate cuts.
 */

import * as logger from '../../utils/logger';
import {
  backendApiContainer,
  controlCall,
  isBackendTierRunning,
} from '../docker/control-call';
import { isContainerRunning } from '../docker/is-container-running';

export { backendApiContainer, isBackendTierRunning };

// Plain chat turns are short (seconds–~2 min); 3 min covers the tail without
// stalling the deploy.
const DRAIN_POLL_MS = 2_000;
const DRAIN_TIMEOUT_MS = 3 * 60_000;

interface DrainStatus {
  draining: boolean;
  inFlight: number;
}

/**
 * Read + validate `/api/control/drain-status`. `null` means "unknown"
 * (unreachable door, unexpected shape) — never "0 in flight".
 */
async function readDrainStatus(container: string): Promise<DrainStatus | null> {
  const res = await controlCall('GET', '/api/control/drain-status', {
    container,
  });
  if (!res.success) return null;
  try {
    const parsed: unknown = JSON.parse(res.stdout);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.inFlight !== 'number') return null;
    return { draining: o.draining === true, inFlight: o.inFlight };
  } catch (err) {
    logger.debug(`backend drain-status parse failed: ${String(err)}`);
    return null;
  }
}

/**
 * Refuse new chat turns and wait (bounded) for in-flight generations before
 * the backend recreate. Never throws — `pollMs`/`timeoutMs` exist only so
 * unit tests can run the loop fast.
 */
export async function drainBackend(opts: {
  dryRun: boolean;
  pollMs?: number;
  timeoutMs?: number;
}): Promise<void> {
  if (opts.dryRun) {
    logger.info(
      '[DRY-RUN] Would drain in-flight chat generations before recreating the backend tier',
    );
    return;
  }

  const pollMs = opts.pollMs ?? DRAIN_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? DRAIN_TIMEOUT_MS;
  const container = backendApiContainer();

  if (!(await isContainerRunning(container))) {
    logger.debug('No backend-api container running; skipping backend drain.');
    return;
  }

  logger.step('Draining in-flight chat generations before backend recreate...');
  const begin = await controlCall('POST', '/api/control/drain', { container });
  if (!begin.success) {
    logger.warn(
      `Backend drain unavailable — proceeding (cut turns will be recovered by the watchdog): ${begin.stderr.trim().slice(0, 200)}`,
    );
    return;
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await readDrainStatus(container);
    if (status && status.inFlight === 0) {
      logger.info('All in-flight chat generations finished.');
      return;
    }
    if (Date.now() >= deadline) {
      logger.warn(
        `Backend still has ${status?.inFlight ?? 'unknown'} generation(s) after ${timeoutMs / 1000}s — recreating anyway; the recovery watchdog will finalize them.`,
      );
      return;
    }
    await Bun.sleep(pollMs);
  }
}

/**
 * Clear the drain flag once the tier is healthy again. Best-effort: the
 * backend's own drain expiry clears the flag anyway, so chats can never be
 * refused forever.
 */
export async function endDrainBackend(): Promise<void> {
  const container = backendApiContainer();
  if (!(await isContainerRunning(container))) return;
  const res = await controlCall('POST', '/api/control/end-drain', {
    container,
  });
  if (!res.success) {
    logger.debug(
      `backend endDrain failed (auto-expiry backstop will clear the flag): ${res.stderr.trim().slice(0, 200)}`,
    );
  }
}
