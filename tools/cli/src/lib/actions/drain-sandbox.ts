/**
 * Deploy DRAIN orchestration for the always-roll sandbox tier.
 *
 * `tale deploy` recreates the single sandbox spawner in-place on a version
 * change (the tier dropped blue-green — it's now one container,
 * `tale-<proj>-sandbox`, rolled in place via the stateful compose like the
 * backend tier).
 * The recreate restarts the spawner and would SIGKILL its in-flight one-shot
 * executions. `drainSandbox` tells the spawner to refuse NEW work (POST
 * /v1/drain; spawner_client retries land on the restarted spawner) and waits
 * for in-flight one-shots to finish before the recreate.
 *
 * The control channel is `docker exec <sandbox-container> bun
 * /app/src/control-cli.ts drain|drain-status` — the spawner's control routes
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
import { docker } from '../docker/docker';
import { isContainerRunning } from '../docker/is-container-running';

/** The signed control client baked into the spawner image (WORKDIR /app). */
const CONTROL_CLIENT = '/app/src/control-cli.ts';

type ControlCommand = 'drain' | 'drain-status';

/**
 * The in-container shell line for one control call. The signed client is the
 * door; the `curl` branch fires ONLY when the running image predates it (the
 * single deploy that rolls a pre-signed-client spawner, whose routes were still
 * open) — a one-release shim to drop once no such spawner can be running.
 * Nothing secret appears here: the token is read by the client from the
 * container's own environment.
 */
export function controlScript(command: ControlCommand): string {
  const method = command === 'drain' ? 'POST' : 'GET';
  return (
    `if [ -f ${CONTROL_CLIENT} ]; then exec bun ${CONTROL_CLIENT} ${command}; ` +
    `else exec curl -fsS -X ${method} http://localhost:8003/v1/${command}; fi`
  );
}

function controlCall(container: string, command: ControlCommand) {
  return docker('exec', container, 'sh', '-c', controlScript(command));
}

// One-shot sandbox executions are short (default 30s, max 5min), so the drain
// poll is bounded — past the ceiling we recreate anyway (the spawner's own
// SIGTERM drain + stop_grace_period is the backstop). Same timing the old
// blue-green flip's drainOldColor used.
const DRAIN_POLL_MS = 2_000;
const DRAIN_TIMEOUT_MS = 5 * 60_000;

interface DrainStatus {
  inFlight: number;
}

/**
 * Read + validate the spawner's `/v1/drain-status`. Returns `null` when the
 * endpoint is unreachable or the JSON shape is unexpected — callers must treat
 * `null` as "unknown", NOT as "0 in flight".
 */
async function readDrainStatus(container: string): Promise<DrainStatus | null> {
  const res = await controlCall(container, 'drain-status');
  if (!res.success) return null;
  try {
    const parsed: unknown = JSON.parse(res.stdout);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.inFlight !== 'number') return null;
    return { inFlight: o.inFlight };
  } catch (err) {
    logger.debug(`sandbox drain-status parse failed: ${String(err)}`);
    return null;
  }
}

/**
 * Refuse new sandbox executions and wait (bounded) for in-flight one-shots to
 * finish before the spawner recreate. Never throws — a drain failure degrades
 * to "proceed; the spawner's SIGTERM drain handles stragglers".
 * `pollMs`/`timeoutMs` default to the module constants and exist only so unit
 * tests can run the loop fast.
 */
export async function drainSandbox(opts: {
  dryRun: boolean;
  pollMs?: number;
  timeoutMs?: number;
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

  if (!(await isContainerRunning(container))) {
    logger.debug('No sandbox container running; skipping sandbox drain.');
    return;
  }

  logger.step('Draining in-flight sandbox executions before recreate...');
  const drain = await controlCall(container, 'drain');
  if (!drain.success) {
    logger.warn(
      `Sandbox drain unavailable — proceeding (the spawner's SIGTERM drain handles in-flight executions): ${drain.stderr.trim().slice(0, 200)}`,
    );
    return;
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await readDrainStatus(container);
    if (status && status.inFlight === 0) {
      logger.info('All in-flight sandbox executions finished.');
      return;
    }
    if (Date.now() >= deadline) {
      logger.warn(
        `Sandbox still has ${status?.inFlight ?? 'unknown'} execution(s) after ${timeoutMs / 1000}s — recreating anyway; the spawner's SIGTERM drain handles stragglers.`,
      );
      return;
    }
    await Bun.sleep(pollMs);
  }
}
