/**
 * The run liveness contract.
 *
 * Every non-terminal `automationRuns` row carries `wakeAt` — a promise,
 * declared by whoever last moved the run, that by that instant the run will
 * have made another observable move (claimed, parked, finished, or renewed
 * the promise). The stepper's heartbeat renews it while a long node works, so
 * a slow model or a long connector call never reads as abandoned; the
 * liveness sweep re-pokes only runs whose promise actually expired — which,
 * after a lost scheduled wake (a deploy swapping the bundle mid-flight, a
 * killed action, a restart), is the only way the run ever moves again.
 *
 * Plain constants, no 'use node': imported by both the V8 mutations that
 * write promises and the node stepper that renews them.
 */

/** How long a claimed walker may go silent before its run counts as
 * abandoned. Renewed by every heartbeat, progress record, and park — the
 * value bounds walker death detection, NOT node duration. */
export const RUN_CLAIM_PROMISE_MS = 3 * 60_000;

/** How often a live walker renews its promise while a node body runs. Must
 * be comfortably under {@link RUN_CLAIM_PROMISE_MS} so one missed beat (an
 * OCC retry, a slow scheduler) does not read as death. */
export const RUN_HEARTBEAT_INTERVAL_MS = 60_000;

/** Slack the sweep grants past `wakeAt` before it calls a promise broken —
 * absorbs scheduler jitter and action queue latency, nothing more. */
export const LIVENESS_GRACE_MS = 60_000;

/** After the sweep pokes a run it re-arms the promise this far out, so the
 * next tick does not double-poke while the poked step sits in the queue; a
 * poke lost to the same outage is retried one re-arm later. */
export const LIVENESS_REARM_MS = 2 * 60_000;

/** Overdue runs re-poked per status per sweep tick, oldest first. */
export const LIVENESS_SWEEP_LIMIT = 20;
