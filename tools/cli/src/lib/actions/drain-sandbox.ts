/**
 * Deploy DRAIN orchestration for the always-roll sandbox tier.
 *
 * `tale deploy` recreates the single sandbox spawner in-place on a version
 * change (the tier dropped blue-green — it's now one container,
 * `tale-<proj>-sandbox`, rolled in place via the stateful compose like the
 * backend tier).
 * The recreate restarts the spawner and would SIGKILL the sessions it holds.
 * `drainSandbox` tells the spawner to refuse NEW work (POST /v1/drain;
 * spawner_client retries land on the restarted spawner) and waits until
 * GET /v1/drain-status reports no session before the recreate. That answer is
 * parsed with the same schema the managed runtime reads it with
 * (deployment/runtime-spawner.ts).
 *
 * The control channel is an exec of `bun /app/src/control-cli.ts
 * drain|drain-status` in the sandbox container, through the deployment's
 * runtime (`docker exec` on Docker) — the spawner's control routes
 * are HMAC-gated like every other route (they share the listener that sits on
 * the sandbox network every session container reaches), and the signed client
 * shipped in the spawner image signs with the SANDBOX_TOKEN the container
 * already holds. So the shared secret never crosses this process, its argv, or
 * its logs — the same shape as the backend tier's control door
 * (docker/control-call.ts expands `$TALE_CONTROL_TOKEN` inside its container).
 *
 * Best-effort by design: a spawner that isn't running yet (first deploy) or
 * any transient error just skips the drain and proceeds — the spawner's own
 * SIGTERM drain + `stop_grace_period` is the backstop for whatever the recreate
 * cuts.
 */

import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import {
  parseSpawnerDrainStatus,
  type SpawnerDrainStatus,
  spawnerJson,
} from '../deployment/runtime-spawner';
import { dockerRuntime } from '../runtime/docker/docker-runtime';
import type { StackRuntime } from '../runtime/types';

/** The signed control client baked into the spawner image (WORKDIR /app). */
const CONTROL_CLIENT = '/app/src/control-cli.ts';

type ControlCommand = 'drain' | 'drain-status';

/**
 * Budget for one control call. The routes answer in milliseconds; a spawner
 * that accepts TCP but never answers must not hang `tale deploy` inside the
 * deploy lock (the same shape docker/control-call.ts bounds for the backend
 * door). Past it the call fails and the drain degrades to "proceed".
 */
export const CONTROL_TIMEOUT_S = 15;

/**
 * The in-container shell line for one control call, wrapped in `timeout(1)`.
 * The signed client is the door; the `curl` branch fires ONLY when the running
 * image predates it (the single deploy that rolls a pre-signed-client spawner,
 * whose routes were still open) — a one-release shim to drop once no such
 * spawner can be running. Nothing secret appears here: the token is read by
 * the client from the container's own environment.
 */
export function controlScript(command: ControlCommand): string {
  const method = command === 'drain' ? 'POST' : 'GET';
  const bounded = `exec timeout ${CONTROL_TIMEOUT_S}`;
  return (
    `if [ -f ${CONTROL_CLIENT} ]; then ${bounded} bun ${CONTROL_CLIENT} ${command}; ` +
    `else ${bounded} curl -fsS -X ${method} http://localhost:8003/v1/${command}; fi`
  );
}

function controlCall(
  runtime: StackRuntime,
  container: string,
  command: ControlCommand,
) {
  return runtime.exec(container, ['sh', '-c', controlScript(command)]);
}

// One-shot sandbox executions are short (default 30s, max 5min), so the drain
// poll is bounded — past the ceiling we recreate anyway (the spawner's own
// SIGTERM drain + stop_grace_period is the backstop). Same timing the old
// blue-green flip's drainOldColor used.
const DRAIN_POLL_MS = 2_000;
const DRAIN_TIMEOUT_MS = 5 * 60_000;

/**
 * Read the spawner's `/v1/drain-status`. `null` means the call itself failed
 * (unreachable, timed out) — "unknown", NOT "nothing in flight", so the poll
 * goes on. An answer that breaks the spawner's contract throws; the caller
 * warns and keeps treating it as "unknown", because a drifted answer proves
 * nothing about the sessions the spawner still holds.
 */
async function readDrainStatus(
  runtime: StackRuntime,
  container: string,
): Promise<SpawnerDrainStatus | null> {
  const res = await controlCall(runtime, container, 'drain-status');
  if (!res.success) {
    logger.debug(
      `sandbox drain-status unavailable: ${res.stderr.trim().slice(0, 200)}`,
    );
    return null;
  }
  return parseSpawnerDrainStatus(spawnerJson(res.stdout));
}

/**
 * Refuse new sandbox sessions and wait (bounded) for the held sessions to
 * finish before the spawner recreate. Never throws — a drain failure degrades
 * to "proceed; the spawner's SIGTERM drain handles stragglers".
 * `pollMs`/`timeoutMs` default to the module constants and exist only so unit
 * tests can run the loop fast.
 */
export async function drainSandbox(opts: {
  dryRun: boolean;
  pollMs?: number;
  timeoutMs?: number;
  /** The runtime the command selected; Docker when not given. */
  runtime?: StackRuntime;
}): Promise<void> {
  if (opts.dryRun) {
    logger.info(
      '[DRY-RUN] Would drain in-flight sandbox executions before recreating the spawner',
    );
    return;
  }

  const pollMs = opts.pollMs ?? DRAIN_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? DRAIN_TIMEOUT_MS;
  const container = `${getProjectId()}-sandbox`;
  const runtime = opts.runtime ?? dockerRuntime;

  if (!(await runtime.isRunning(container))) {
    logger.debug('No sandbox container running; skipping sandbox drain.');
    return;
  }

  logger.step('Draining in-flight sandbox executions before recreate...');
  const drain = await controlCall(runtime, container, 'drain');
  if (!drain.success) {
    logger.warn(
      `Sandbox drain unavailable — proceeding (the spawner's SIGTERM drain handles in-flight executions): ${drain.stderr.trim().slice(0, 200)}`,
    );
    return;
  }

  const deadline = Date.now() + timeoutMs;
  let contractWarned = false;
  for (;;) {
    let status: SpawnerDrainStatus | null;
    try {
      status = await readDrainStatus(runtime, container);
    } catch (err) {
      status = null;
      if (!contractWarned) {
        contractWarned = true;
        logger.warn(
          `Sandbox drain status is not the spawner's contract — treating it as unknown until the drain budget runs out: ${errorMessage(err).slice(0, 300)}`,
        );
      }
    }
    if (status && status.sessions === 0) {
      logger.info('All sandbox sessions finished.');
      return;
    }
    if (Date.now() >= deadline) {
      logger.warn(
        `Sandbox still has ${status?.sessions ?? 'unknown'} session(s) after ${timeoutMs / 1000}s — recreating anyway; the spawner's SIGTERM drain handles stragglers.`,
      );
      return;
    }
    await Bun.sleep(pollMs);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
