import type { BackendEnv } from './env.ts';
import { NODE_SHUTDOWN_GRACE_MS, type ShutdownState } from './lib/shutdown.ts';

/**
 * The order a backend process stops in, apart from `main.ts` so it can be
 * tested step by step (like `http-shutdown.ts`).
 *
 * The work first learns that shutdown has begun, before anything waits: an
 * automation walker hands its run on at its next step boundary, and an
 * agent turn's drive window ends and leaves the turn to a next window. Then
 * the HTTP server closes and pg-boss stops fetching. A worker waits for its
 * walkers to hand on — a step still running at the grace is cut and handed
 * on too — and releases whatever run it still holds, so another worker
 * takes it at once instead of after its lease lapses. Only then does it
 * wait out its other jobs, up to the drain budget, and close its stores.
 *
 * A container's stop grace must leave room for all of it: at least the
 * drain budget and 15 seconds more (compose.yml, the CLI's compose
 * services).
 */

/** The drain budget of the api role: it runs no jobs, so it only waits out
 * the HTTP close and pg-boss's own stop. */
const API_SHUTDOWN_DRAIN_MS = 15_000;

/** The drain budget of a worker: a step's grace, the hand-on, and the agent
 * starts and other jobs that finish inside it. */
const WORKER_SHUTDOWN_DRAIN_MS = 90_000;

/** How long past its grace the sequence waits for a cut step to hand its
 * run on before it releases the run itself. */
const SETTLE_SLACK_MS = 10_000;

/** How long a stopping process waits for its jobs: `SHUTDOWN_DRAIN_MS`, or
 * the role's own default. */
export function shutdownDrainMs(
  env: Pick<BackendEnv, 'ROLE' | 'SHUTDOWN_DRAIN_MS'>,
): number {
  return (
    env.SHUTDOWN_DRAIN_MS ??
    (env.ROLE === 'api' ? API_SHUTDOWN_DRAIN_MS : WORKER_SHUTDOWN_DRAIN_MS)
  );
}

/** How long a step may keep running once shutdown has begun: the node grace,
 * or a third of a shorter drain budget so the hand-on still fits in it. */
export function shutdownGraceMs(drainMs: number): number {
  return Math.min(NODE_SHUTDOWN_GRACE_MS, Math.floor(drainMs / 3));
}

/**
 * Whether a worker hands a job it just fetched over to another process
 * instead of running it (`jobs/runner.ts`): its replica is being drained, or
 * shutdown has begun — a job started then would only be cut.
 */
export function shouldDeferJobs(
  shutdown: ShutdownState,
  draining: () => Promise<boolean>,
): () => Promise<boolean> {
  return async () => shutdown.shuttingDown || (await draining());
}

export interface ShutdownSteps {
  role: BackendEnv['ROLE'];
  drainMs: number;
  /** The process's shutdown state; `begin` is the first step. */
  shutdown: ShutdownState;
  /** Close the HTTP server; null when this process serves none. */
  closeServer: (() => Promise<void>) | null;
  /** pg-boss's graceful stop: it stops fetching at once and waits for the
   * jobs it is running up to `timeout`. */
  stopBoss: (options: { graceful: true; timeout: number }) => Promise<void>;
  /** Wait for this process's automation turns to end; answers how many are
   * still going. */
  settleLiveTurns: (timeoutMs: number) => Promise<number>;
  /** Hand on every run this process still holds; answers how many. */
  releaseOwnedRunLeases: () => Promise<number>;
  /** Close the database pools. */
  closeStores: () => Promise<void>;
}

export async function runShutdownSequence(
  reason: string,
  steps: ShutdownSteps,
): Promise<void> {
  const graceMs = shutdownGraceMs(steps.drainMs);
  steps.shutdown.begin(reason, graceMs);
  if (steps.closeServer !== null) await steps.closeServer();
  // Not awaited yet: fetching stops now, and the jobs still running are
  // waited out below, after this process's runs have been handed on.
  const stopping = steps
    .stopBoss({ graceful: true, timeout: steps.drainMs })
    .catch((error: unknown) => {
      console.error('[backend] job queue did not stop cleanly:', error);
    });
  if (steps.role !== 'api') {
    try {
      const stillGoing = await steps.settleLiveTurns(graceMs + SETTLE_SLACK_MS);
      if (stillGoing > 0) {
        console.warn(
          `[backend] ${stillGoing} automation turn(s) still running after the shutdown grace — releasing their runs`,
        );
      }
    } catch (error) {
      console.warn('[backend] waiting for automation turns failed:', error);
    }
    try {
      const released = await steps.releaseOwnedRunLeases();
      if (released > 0) {
        console.log(
          `[backend] handed ${released} automation run(s) on to another worker`,
        );
      }
    } catch (error) {
      // Each lease still lapses on its own, and a live worker's sweep takes
      // the run over then.
      console.error('[backend] could not hand automation runs on:', error);
    }
  }
  await stopping;
  await steps.closeStores();
}
