/**
 * Deploy DRAIN orchestration for the always-roll convex tier.
 *
 * `tale deploy` recreates the convex container in-place on a version change,
 * restarting the backend and killing every in-flight action — including
 * non-durable chat generation. `drainConvex` tells the backend to refuse NEW
 * chat turns (the client retries onto the restart) and waits for in-flight
 * generations to finish before the recreate; `endDrainConvex` clears the flag
 * once convex is healthy again. Mirrors the sandbox tier's `/v1/drain` flow
 * (drain-sandbox.ts), but the control channel is `bunx convex run` through the
 * platform container (docker/convex-run.ts).
 *
 * Best-effort by design: an older backend that predates the drain control
 * plane (the first deploy that ships this feature), or any transient error,
 * just skips the drain and proceeds — the recovery watchdog
 * (`agents/recover_stuck_chat_turns.ts`) finalizes whatever the recreate cuts.
 */

import * as logger from '../../utils/logger';
import {
  parseSentinelJson,
  redactAdminKey,
  runConvexAdmin,
} from '../docker/convex-run';
import { findPlatformContainer } from '../docker/find-platform-container';

// Plain chat turns are short (seconds–~2 min); 3 min covers the tail without
// stalling the deploy. Past the budget we recreate anyway and let the watchdog
// finalize stragglers (mirrors drain-sandbox.ts's drain ceiling).
const DRAIN_POLL_MS = 2_000;
const DRAIN_TIMEOUT_MS = 3 * 60_000;

interface DrainStatus {
  draining: boolean;
  inFlight: number;
}

function isDrainStatus(value: unknown): value is DrainStatus {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).inFlight === 'number'
  );
}

function short(text: string): string {
  return redactAdminKey(text).trim().slice(0, 200);
}

/**
 * Refuse new chat turns and wait (bounded) for in-flight generations to finish
 * before the convex recreate. Never throws — a drain failure degrades to
 * "proceed; the watchdog recovers cut turns". `pollMs`/`timeoutMs` default to
 * the module constants and exist only so unit tests can run the loop fast.
 */
export async function drainConvex(opts: {
  dryRun: boolean;
  pollMs?: number;
  timeoutMs?: number;
}): Promise<void> {
  if (opts.dryRun) {
    logger.info(
      '[DRY-RUN] Would drain in-flight chat generations before recreating convex',
    );
    return;
  }

  const pollMs = opts.pollMs ?? DRAIN_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? DRAIN_TIMEOUT_MS;

  let container: string;
  try {
    container = await findPlatformContainer();
  } catch {
    logger.debug('No platform container found; skipping convex drain.');
    return;
  }

  logger.step('Draining in-flight chat generations before convex recreate...');
  const begin = await runConvexAdmin('control/drain:beginDrain', { container });
  if (!begin.success) {
    logger.warn(
      `Convex drain unavailable — proceeding (cut turns will be recovered by the watchdog): ${short(begin.stderr || begin.stdout)}`,
    );
    return;
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await runConvexAdmin('control/drain:drainStatus', {
      container,
    });
    const value = res.success ? parseSentinelJson<unknown>(res.stdout) : null;
    const status = isDrainStatus(value) ? value : null;
    if (status && status.inFlight === 0) {
      logger.info('All in-flight chat generations finished.');
      return;
    }
    if (Date.now() >= deadline) {
      logger.warn(
        `Convex still has ${status?.inFlight ?? 'unknown'} generation(s) after ${timeoutMs / 1000}s — recreating anyway; the recovery watchdog will finalize them.`,
      );
      return;
    }
    await Bun.sleep(pollMs);
  }
}

/**
 * Clear the drain flag after convex is healthy again. Best-effort: if it fails
 * (older backend, transient error), the backend's `drainExpiresAt` auto-expiry
 * clears the flag within 15 min so chats can never be refused forever.
 */
export async function endDrainConvex(): Promise<void> {
  let container: string;
  try {
    container = await findPlatformContainer();
  } catch {
    return;
  }
  const res = await runConvexAdmin('control/drain:endDrain', { container });
  if (!res.success) {
    logger.debug(
      `endDrain failed (auto-expiry backstop will clear the flag): ${short(res.stderr || res.stdout)}`,
    );
  }
}
