import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { generateSandboxColorCompose } from '../compose/generators/generate-sandbox-color-compose';
import type { DeploymentColor, ServiceConfig } from '../compose/types';
import { docker } from '../docker/docker';
import { dockerCompose } from '../docker/docker-compose';
import { removeContainer } from '../docker/remove-container';
import { stopContainer } from '../docker/stop-container';
import { waitForHealthy } from '../docker/wait-for-healthy';

// One-shot sandbox executions are short (default 30s, max 5min), so the drain
// poll is bounded — past the ceiling we tear down anyway (the spawner's own
// SIGTERM drain + stop_grace_period is the backstop).
const DRAIN_POLL_MS = 2_000;
const DRAIN_TIMEOUT_MS = 5 * 60_000;

interface FlipSandboxOptions {
  config: ServiceConfig;
  deployDir: string;
  /** Platform's current (old) colour, or `null` on a first deploy / legacy single-container migration. */
  currentColor: DeploymentColor | null;
  /** Platform's next (new) colour — the sandbox tier rides the same colour. */
  nextColor: DeploymentColor;
  dryRun: boolean;
  streamLogs: boolean;
  /** env.HEALTH_CHECK_TIMEOUT (seconds). */
  healthTimeout: number;
  /** Drain poll interval / ceiling. Default to the module constants; exposed
   *  only so unit tests can run the drain loop fast. */
  drainPollMs?: number;
  drainTimeoutMs?: number;
}

/**
 * Zero-gap blue-green roll of the sandbox tier (`sandbox` + `sandbox-egress`),
 * sharing the platform's colour. Sequence:
 *
 *   1. Bring up the NEXT colour's spawner + egress (their own containers, on the
 *      shared `tale-sandbox-net`; the spawner advertises `tale.color=<next>`).
 *   2. Wait for the next spawner to pass its health check.
 *   3. Move the bare `sandbox` network alias onto the next spawner (Convex's
 *      `http://sandbox:8003` now resolves to the new colour for NEW executions;
 *      in-flight cancels still target the old colour via its stored row colour).
 *   4. Drain the OLD colour: POST /v1/drain (it 503s new work; spawner_client
 *      retries land on the new colour), then poll /v1/drain-status until its
 *      in-flight one-shot count hits 0.
 *   5. If the old colour has NO live sessions, tear it down (spawner + egress +
 *      its session containers). If it DOES, LINGER it: leave the spawner +
 *      egress + session containers running on the still-resolvable
 *      `sandbox-<old>` alias so a long agent turn survives the deploy, AND
 *      revoke its bare `sandbox` alias (it acquired one when IT was active) so
 *      `sandbox` resolves to EXACTLY the new colour. Without the revoke both
 *      colours answer to `sandbox`, Docker's embedded DNS round-robins NEW
 *      session-creates across both, and the ones hitting the draining old colour
 *      fail with 503 "spawner is draining; create on the active colour". The old
 *      spawner keeps serving exec/cancel/attach for its sessions while 503ing
 *      NEW work; Convex routes session ops to `sandbox-<spawnerColor>` (the
 *      colour recorded on the session row at create).
 *
 * Linger bounds (no orphans): the lingering spawner self-reaps its sessions
 * after `SANDBOX_SESSION_MAX_LINGER_MS` even if this CLI dies mid-flip, and the
 * NEXT flip back to that colour reaps any leftover session containers (step 1).
 * Because the model is exactly two colours, a session survives AT MOST one flip;
 * a second flip reclaims it (compute released, workspace preserved for resume).
 *
 * NOTE: the drain channel is `docker exec <spawner> curl localhost:8003/...`
 * (the spawner is not host-exposed; `docker exec` implies host-root).
 */
export async function flipSandboxTier(opts: FlipSandboxOptions): Promise<void> {
  const pid = getProjectId();
  const { config, deployDir, currentColor, nextColor, dryRun } = opts;
  const prefix = dryRun ? '[DRY-RUN] ' : '';
  const internalNet = `${pid}_internal`;
  const nextSpawner = `${pid}-sandbox-${nextColor}`;
  const services = [`sandbox-egress-${nextColor}`, `sandbox-${nextColor}`];

  logger.step(`${prefix}Rolling sandbox tier → ${nextColor} (blue-green)...`);

  if (dryRun) {
    logger.info(
      `${prefix}Would bring up ${services.join(', ')}, move the \`sandbox\` ` +
        `alias to ${nextColor}, drain ${currentColor ?? 'the legacy spawner'}, ` +
        `then remove it.`,
    );
    return;
  }

  // 1. Clean any stale next-colour containers from an aborted prior flip, then
  //    bring the next colour up. Because the model is exactly two colours, the
  //    nextColour is also the colour that may still be LINGERING from the last
  //    flip (it kept serving its sessions) — so reap its leftover session
  //    containers here too, the reaper-of-last-resort for a session that
  //    survived one flip but not a second.
  for (const svc of services) {
    const name = `${pid}-${svc}`;
    if (await stopContainer(name)) await removeContainer(name);
  }
  await removeColorSessionContainers(pid, nextColor);
  const compose = generateSandboxColorCompose(config, nextColor);
  const up = await dockerCompose(compose, ['up', '-d', ...services], {
    projectName: `${pid}-sandbox-${nextColor}`,
    cwd: deployDir,
  });
  if (!up.success) {
    throw new Error(
      `Failed to start sandbox ${nextColor}: ${up.stderr.trim()}`,
    );
  }

  // 2. Health.
  const healthy = await waitForHealthy(nextSpawner, {
    timeout: opts.healthTimeout,
    streamLogs: opts.streamLogs,
  });
  if (!healthy) {
    throw new Error(`sandbox-${nextColor} failed its health check`);
  }

  // 3. Point the active `sandbox` alias at the new colour.
  await moveSandboxAlias(internalNet, nextSpawner, nextColor);

  // 4 + 5. Drain the previous colour, then EITHER tear it down (no live
  //         sessions) or LINGER it (live sessions keep running on
  //         `sandbox-<old>` until they end or the spawner's max-linger reap).
  if (currentColor) {
    const outcome = await drainOldColor(pid, currentColor, {
      pollMs: opts.drainPollMs,
      timeoutMs: opts.drainTimeoutMs,
    });
    if (outcome.kind === 'gone') {
      // Drain signal never landed — the old colour is already gone or predates
      // the drain endpoint. Nothing alive to linger; reclaim its containers.
      await teardownColor(pid, currentColor);
    } else if (outcome.status && outcome.status.sessions > 0) {
      logger.warn(
        `sandbox ${currentColor} has ${outcome.status.sessions} live session(s) — lingering on sandbox-${currentColor} until they end or its max-linger TTL; not tearing it down. A subsequent flip back to ${currentColor} reclaims it.`,
      );
      await releaseSandboxAlias(
        internalNet,
        `${pid}-sandbox-${currentColor}`,
        currentColor,
      );
    } else if (outcome.status === null) {
      // Drain was acknowledged but its session count stayed UNKNOWN to the
      // deadline (status endpoint unreachable / malformed). Treat unknown as
      // "may still have sessions" and LINGER — tearing down here could kill a
      // live agent turn. The spawner's own max-linger reap is the backstop.
      logger.warn(
        `sandbox ${currentColor} drained but its session count is unknown — lingering on sandbox-${currentColor} rather than risk tearing down live sessions. Its max-linger TTL (or the next flip back) reclaims it.`,
      );
      await releaseSandboxAlias(
        internalNet,
        `${pid}-sandbox-${currentColor}`,
        currentColor,
      );
    } else {
      await teardownColor(pid, currentColor);
    }
  } else {
    await teardownLegacy(pid);
  }

  logger.success(`Sandbox tier is now on ${nextColor}`);
}

/**
 * Give the next spawner the bare `sandbox` alias on the internal network. It is
 * already attached (compose added the `sandbox-<color>` service-key alias), so
 * we disconnect + reconnect with BOTH aliases. The brief disconnect is safe:
 * the new colour isn't serving `sandbox` yet (Convex still resolves it to the
 * old colour), and the old colour keeps the alias until teardown.
 */
async function moveSandboxAlias(
  network: string,
  container: string,
  color: DeploymentColor,
): Promise<void> {
  // Disconnect is best-effort: if it wasn't connected (unexpected) the connect
  // below still establishes the aliases.
  const dis = await docker('network', 'disconnect', network, container);
  if (!dis.success) {
    logger.debug(
      `network disconnect ${container} (continuing): ${dis.stderr.trim()}`,
    );
  }
  const con = await docker(
    'network',
    'connect',
    '--alias',
    'sandbox',
    '--alias',
    `sandbox-${color}`,
    network,
    container,
  );
  if (!con.success) {
    throw new Error(
      `Failed to move the \`sandbox\` alias to ${container}: ${con.stderr.trim()}`,
    );
  }
}

/**
 * Revoke the bare `sandbox` alias from a LINGERING old colour while keeping its
 * colour-suffixed `sandbox-<color>` alias. The old colour acquired `sandbox`
 * when IT was active (its own prior flip); if it keeps it, both colours answer
 * to `sandbox`, Docker's embedded DNS round-robins NEW session-creates across
 * both, and the ones hitting the now-draining old colour fail with 503 "spawner
 * is draining; create on the active colour" — persistently, because the
 * platform's fetch keep-alive pool pins to the old colour's IP.
 *
 * Docker has no per-alias edit, so we disconnect + reconnect with only the
 * colour alias. The resulting internal-network IP change is deliberately
 * harmless here and in fact helps: it severs the platform's pinned keep-alive
 * socket to the draining colour (forcing a fresh DNS resolve onto the active
 * colour) and the lingering session's own stream, which the resilient exec
 * drain re-attaches via the retained `sandbox-<color>`. Safe to run because the
 * caller invokes it only AFTER the one-shot drain reached inFlight === 0, so no
 * in-flight one-shot is cut. Best-effort: a gone/unattached container is a no-op.
 */
async function releaseSandboxAlias(
  network: string,
  container: string,
  color: DeploymentColor,
): Promise<void> {
  const dis = await docker('network', 'disconnect', network, container);
  if (!dis.success) {
    // Already gone / not attached — nothing is holding the `sandbox` alias.
    logger.debug(
      `release \`sandbox\` alias: ${container} not disconnected (continuing): ${dis.stderr.trim()}`,
    );
    return;
  }
  const con = await docker(
    'network',
    'connect',
    '--alias',
    `sandbox-${color}`,
    network,
    container,
  );
  if (!con.success) {
    // Reconnect failed after a successful disconnect: the old colour is now off
    // the internal network, so its lingering sessions are unreachable until the
    // spawner's max-linger reap or the next flip back reclaims it. Surface it.
    logger.warn(
      `Failed to re-attach ${container} with its \`sandbox-${color}\` alias — its lingering sessions may be unreachable until the next flip: ${con.stderr.trim()}`,
    );
  }
}

interface DrainStatus {
  inFlight: number;
  sessions: number;
}

/**
 * Read + validate a colour's `/v1/drain-status`. Returns `null` when the
 * endpoint is unreachable or the JSON shape is unexpected — callers must treat
 * `null` as "unknown" and NOT as "0 in flight / 0 sessions" (that would tear a
 * colour down while work is still running). `sessions` defaults to 0 on an
 * older spawner that doesn't report it.
 */
async function readDrainStatus(
  pid: string,
  color: DeploymentColor,
): Promise<DrainStatus | null> {
  const res = await docker(
    'exec',
    `${pid}-sandbox-${color}`,
    'curl',
    '-fsS',
    'http://localhost:8003/v1/drain-status',
  );
  if (!res.success) return null;
  try {
    const parsed: unknown = JSON.parse(res.stdout);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.inFlight !== 'number') return null;
    return {
      inFlight: o.inFlight,
      sessions: typeof o.sessions === 'number' ? o.sessions : 0,
    };
  } catch (err) {
    logger.debug(`drain-status parse failed: ${String(err)}`);
    return null;
  }
}

/**
 * Result of draining a colour:
 *  - `gone`: the drain signal never landed (old colour already gone / predates
 *    the endpoint) — there's nothing alive to linger, so teardown is safe.
 *  - `drained`: the drain was acknowledged. `status` is the FINAL drain status
 *    (so the caller can decide teardown vs. linger on the session count), or
 *    `null` when the session count stayed UNKNOWN to the deadline — which the
 *    caller must treat as "may still have sessions", NOT as zero.
 */
type DrainOutcome =
  | { kind: 'gone' }
  | { kind: 'drained'; status: DrainStatus | null };

/**
 * Tell the old colour to stop accepting new work and wait for its in-flight
 * one-shots to drain. See {@link DrainOutcome} for how the caller reads the
 * result.
 */
async function drainOldColor(
  pid: string,
  oldColor: DeploymentColor,
  timing: { pollMs?: number; timeoutMs?: number } = {},
): Promise<DrainOutcome> {
  const pollMs = timing.pollMs ?? DRAIN_POLL_MS;
  const timeoutMs = timing.timeoutMs ?? DRAIN_TIMEOUT_MS;
  const container = `${pid}-sandbox-${oldColor}`;
  logger.step(`Draining sandbox ${oldColor}...`);

  const drain = await docker(
    'exec',
    container,
    'curl',
    '-fsS',
    '-X',
    'POST',
    'http://localhost:8003/v1/drain',
  );
  if (!drain.success) {
    // Old colour may already be gone / lack the endpoint — nothing to drain.
    logger.debug(
      `drain signal to ${container} failed (continuing): ${drain.stderr.trim()}`,
    );
    return { kind: 'gone' };
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await readDrainStatus(pid, oldColor);
    if (status && status.inFlight === 0) return { kind: 'drained', status };
    if (Date.now() >= deadline) {
      logger.warn(
        `sandbox ${oldColor} still draining after ${timeoutMs / 1000}s — proceeding.`,
      );
      return { kind: 'drained', status };
    }
    await Bun.sleep(pollMs);
  }
}

/**
 * Reclaim a colour's session containers (spawned by `docker run`, not compose,
 * labelled `tale.color=<color>` + `tale.sandbox-session=1`). Used both by
 * `teardownColor` and by the next flip's stale-cleanup (the linger reaper of
 * last resort).
 */
async function removeColorSessionContainers(
  pid: string,
  color: DeploymentColor,
): Promise<void> {
  void pid; // labels carry the colour; the project scope is implicit per host.
  const ps = await docker(
    'ps',
    '-aq',
    '--filter',
    `label=tale.color=${color}`,
    '--filter',
    'label=tale.sandbox-session=1',
  );
  if (ps.success) {
    for (const id of ps.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)) {
      await removeContainer(id);
    }
  }
}

/** Stop + remove a colour's spawner, egress, and its (now-drained) session containers. */
async function teardownColor(
  pid: string,
  color: DeploymentColor,
): Promise<void> {
  logger.step(`Removing sandbox ${color}...`);
  for (const svc of [`sandbox-${color}`, `sandbox-egress-${color}`]) {
    const name = `${pid}-${svc}`;
    await stopContainer(name);
    await removeContainer(name);
  }
  await removeColorSessionContainers(pid, color);
}

/** First colored deploy: remove the pre-blue-green single-colour containers (no /v1/drain). */
async function teardownLegacy(pid: string): Promise<void> {
  for (const name of [`${pid}-sandbox`, `${pid}-sandbox-egress`]) {
    if (await stopContainer(name)) {
      await removeContainer(name);
      logger.info(`Removed legacy single-colour ${name}`);
    }
  }
}
