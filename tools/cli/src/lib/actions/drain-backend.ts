/**
 * Deploy DRAIN orchestration for the 0.5 Postgres backend tier.
 *
 * Replacing the api cuts its in-flight chat generations, and replacing a
 * worker cuts the automation steps it is walking. `drainBackend` tells the
 * backend to refuse NEW turns — the drained workers then start no new job
 * and hand their automation runs on at their next step — and waits for the
 * in-flight work to finish; `endDrainBackend` clears the flag once the tier
 * is serving again. A drain 503 is refused in the UI — the client does not
 * retry.
 *
 * The drain is AIMED AT ONE COLOUR. On a blue-green flip both colours of the
 * api are up: the new one is already taking traffic while the old one drains,
 * so an unaimed drain would refuse chats on the colour that just took over.
 * Omit the colour and every replica drains, which is what a tier rolled in
 * place wants (and what an older backend does regardless).
 *
 * The control channel is the shared `controlCall` (docker/control-call.ts) —
 * the same shape as the sandbox tier's drain (drain-sandbox.ts).
 *
 * Best-effort by design: an older backend without the door, a tier that isn't
 * running, or any transient error skips the drain and proceeds — the recovery
 * watchdog finalizes whatever the replacement cuts.
 */

import * as logger from '../../utils/logger';
import type { DeploymentColor } from '../compose/types';
import {
  BACKEND_API_LABEL,
  backendApiContainer,
  backendApiContainers,
  backendApiContainersInColor,
  backendApiDrainWriter,
  controlCall,
  isBackendTierRunning,
} from '../docker/control-call';

export { BACKEND_API_LABEL, backendApiContainer, isBackendTierRunning };

// Plain chat turns are short (seconds–~2 min), an automation step hands its
// run on when it ends, and an agent turn's drive window lasts at most 90 s;
// 3 min covers the tail without stalling the deploy.
const DRAIN_POLL_MS = 2_000;
const DRAIN_TIMEOUT_MS = 3 * 60_000;

/** What `inFlight` is made of, as a backend that counts automation work
 * reports it. An older backend counts chat turns only and sends none. */
interface DrainBreakdown {
  generations: number;
  automationRuns: number;
  agentDrives: number;
}

interface DrainStatus {
  draining: boolean;
  inFlight: number;
  breakdown?: DrainBreakdown;
}

/** The in-flight work in words, for the log. */
function describeInFlight(status: DrainStatus | null): string {
  if (status === null) return 'unknown work';
  if (status.breakdown === undefined) {
    return `${status.inFlight} chat turn(s)`;
  }
  const { generations, automationRuns, agentDrives } = status.breakdown;
  return `${generations} chat turn(s), ${automationRuns} automation step(s) and ${agentDrives} agent turn window(s)`;
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
    const { generations, automationRuns, agentDrives } = o;
    return {
      draining: o.draining === true,
      inFlight: o.inFlight,
      ...(typeof generations === 'number' &&
      typeof automationRuns === 'number' &&
      typeof agentDrives === 'number'
        ? { breakdown: { generations, automationRuns, agentDrives } }
        : {}),
    };
  } catch (err) {
    logger.debug(`backend drain-status parse failed: ${String(err)}`);
    return null;
  }
}

/**
 * Refuse new chat turns, have the drained workers hand their automation runs
 * on, and wait (bounded) for the in-flight work before the backend recreate.
 * Never throws — `pollMs`/`timeoutMs` exist only so unit tests can run the
 * loop fast.
 */
export async function drainBackend(opts: {
  dryRun: boolean;
  /** Aim the drain at one colour's replicas; omitted, it drains every one. */
  colour?: DeploymentColor | null;
  pollMs?: number;
  timeoutMs?: number;
}): Promise<void> {
  const colour = opts.colour ?? null;
  if (opts.dryRun) {
    logger.info(
      `[DRY-RUN] Would drain in-flight chat turns and automation steps on ${colour ? `the ${colour} api` : 'the backend tier'}`,
    );
    return;
  }

  const pollMs = opts.pollMs ?? DRAIN_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? DRAIN_TIMEOUT_MS;
  // An aimed drain must be written by an image that knows `draining_colour`.
  // The retiring colour's leftover singleton (pre-0085) ignores the body.
  const container =
    colour === null
      ? ((await backendApiContainers())[0] ?? null)
      : await backendApiDrainWriter(colour);

  if (container === null) {
    logger.debug('No backend-api container running; skipping backend drain.');
    return;
  }

  logger.step(
    `Draining in-flight chat turns and automation steps on the ${colour ?? 'backend'} api...`,
  );
  const begin = await controlCall('POST', '/api/control/drain', {
    container,
    // An older backend ignores the body and drains everything, which is the
    // pre-colour behaviour and still correct for an in-place roll. An aimed
    // colour flip posts through a new-image replica so the column is written.
    body: colour === null ? {} : { colour },
  });
  if (!begin.success) {
    logger.warn(
      `Backend drain unavailable — proceeding (cut turns will be recovered by the watchdog): ${begin.stderr.trim().slice(0, 200)}`,
    );
    return;
  }

  // First-upgrade leftover: the retiring colour project has no api, and the
  // singleton has already been swept. Nothing left to wait for on that colour.
  if (
    colour !== null &&
    (await backendApiContainersInColor(colour)).length === 0
  ) {
    logger.info(
      `No ${colour} api replicas left to wait out — drain flag is set.`,
    );
    return;
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await readDrainStatus(container);
    if (status && status.inFlight === 0) {
      logger.info('All in-flight chat turns and automation steps finished.');
      return;
    }
    if (Date.now() >= deadline) {
      logger.warn(
        `Backend still has ${describeInFlight(status)} in flight after ${timeoutMs / 1000}s — recreating anyway; the recovery watchdog and the automation liveness sweep will pick them up.`,
      );
      return;
    }
    logger.debug(`Drain waiting on ${describeInFlight(status)}.`);
    await Bun.sleep(pollMs);
  }
}

/**
 * Clear the drain flag once the tier is healthy again. Best-effort: the
 * backend's own drain expiry clears the flag anyway, so chats can never be
 * refused forever.
 */
export async function endDrainBackend(): Promise<void> {
  const container = await backendApiContainer();
  if (container === null) return;
  const res = await controlCall('POST', '/api/control/end-drain', {
    container,
  });
  if (!res.success) {
    logger.debug(
      `backend endDrain failed (auto-expiry backstop will clear the flag): ${res.stderr.trim().slice(0, 200)}`,
    );
  }
}
