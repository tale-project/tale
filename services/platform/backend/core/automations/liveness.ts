/**
 * The run liveness contract.
 *
 * Every non-terminal `automationRuns` row carries `wakeAt` — a promise,
 * declared by whoever last moved the run, that by that instant the run will
 * have made another observable move (claimed, parked, finished, or renewed
 * the promise). A running row also carries a LEASE: the process stepping it
 * and the instant its claim lapses. The stepper's heartbeat renews both while
 * a long node works, so a slow model or a long connector call never reads as
 * abandoned, and a claim refuses a run whose lease is still live — one walker
 * per run, however many step jobs arrive. The liveness sweep re-pokes only
 * runs whose promise actually expired — which, after a lost scheduled wake (a
 * deploy swapping the bundle mid-flight, a killed worker, a restart), is the
 * only way the run ever moves again.
 *
 * Plain constants: imported by both the store that writes promises and
 * leases and the stepper that renews them.
 */

/** The promise a write makes for a run whose next move is a queued job — a
 * new run, a hand-off, a park that came due, a poke: by then a claim has
 * happened, or the sweep pokes it again. */
export const RUN_CLAIM_PROMISE_MS = 3 * 60_000;

/** How long a claimed walker's lease lasts unless renewed. Renewed by every
 * heartbeat and progress record; a running run's `wakeAt` is the same
 * instant, so a walker that died is re-poked within a sweep tick of it. The
 * value bounds walker death detection, NOT node duration. */
export const RUN_LEASE_MS = 30_000;

/** How often a live walker renews its lease while a node body runs. A third
 * of {@link RUN_LEASE_MS}, so two missed beats (a slow database, a busy
 * event loop) still do not read as death. */
export const RUN_HEARTBEAT_INTERVAL_MS = 10_000;

/** Overdue runs re-poked per sweep tick, oldest promise first. */
export const LIVENESS_SWEEP_LIMIT = 50;

/** How long a run that needs a newer engine waits before its step is tried
 * again — while a roll is in progress, the next try is likely to land on a
 * worker of the newer release. */
export const ENGINE_DEFER_MS = 10_000;

/** How recently a newer engine must have claimed a run for an older one to
 * keep re-queueing it every {@link ENGINE_DEFER_MS}. Past it (a rollback
 * after a newer release stepped the run) the run is left to the sweep: one
 * claim attempt per {@link RUN_CLAIM_PROMISE_MS}, never a hot loop. */
export const ENGINE_DEFER_WINDOW_MS = 10 * 60_000;

/** The backstop poll of a run waiting for a person to decide about a write
 * that may already have happened. The decision itself wakes the run; this
 * only catches a wake that was lost. */
export const IN_DOUBT_POLL_MS = 60 * 60_000;
