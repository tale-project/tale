/**
 * The backend's health/restart state machine, as PURE reducers.
 *
 * This is the safety-critical logic behind `bun run dev`: a flapping or
 * crashed local backend is detected by a periodic health probe and restarted
 * up to a cap, and a backend that has been stable long enough has its restart
 * budget forgiven. A soft mistake here (counting a failure twice while a
 * restart is already in flight, never forgiving the budget) leaves the dev
 * loop either thrashing or wedged, so the logic lives here as pure functions,
 * exhaustively unit-tested, separate from the effectful spawn/kill/probe
 * wiring in the dev engine.
 *
 * node-only by policy (consumed by the dev orchestrator), but contains no I/O —
 * the caller performs the kill/spawn/probe and threads the state through.
 */

export const SUPERVISOR_LIMITS = {
  /** Consecutive failed health probes before a restart is attempted. */
  MAX_CONSECUTIVE_FAILURES: 3,
  /** Restart attempts within the stable window before giving up and shutting down. */
  MAX_AUTO_RESTARTS: 5,
  /** Uptime after which a hiccup no longer counts against the restart budget. */
  STABLE_THRESHOLD_MS: 120_000,
  HEALTH_CHECK_INTERVAL_MS: 30_000,
  HEALTH_CHECK_TIMEOUT_MS: 5_000,
} as const;

export interface SupervisorState {
  /** Restart attempts within the current (unstable) window. */
  restartCount: number;
  /** Timestamp (ms) the backend last became ready; 0 if never. */
  backendReadyAt: number;
  /** Consecutive failed health probes since the last success. */
  consecutiveFailures: number;
  /** A restart is currently in flight (suppresses the health loop). */
  restarting: boolean;
  /** Shutdown has begun (suppresses everything). */
  shuttingDown: boolean;
}

export function initialSupervisorState(): SupervisorState {
  return {
    restartCount: 0,
    backendReadyAt: 0,
    consecutiveFailures: 0,
    restarting: false,
    shuttingDown: false,
  };
}

export type HealthAction = 'none' | 'warn' | 'restart';

export interface HealthTickInput {
  /** Did the readiness probe (TCP) succeed this tick? */
  alive: boolean;
  /** Is our spawned child still running? */
  childAlive: boolean;
}

/**
 * Fold one health-probe tick into the supervisor state.
 *
 *  - while shutting down or already restarting → `none` (the loop is suspended);
 *  - a live probe resets the consecutive-failure counter → `none`;
 *  - a dead probe whose LOCAL child has already exited is NOT counted (the
 *    double-count guard — the restart path already owns that case) → `none`;
 *  - otherwise the failure is counted; reaching the threshold resets the counter
 *    and asks for a `restart`, else it asks for a `warn`.
 */
export function onHealthTick(
  state: SupervisorState,
  input: HealthTickInput,
): { state: SupervisorState; action: HealthAction } {
  if (state.shuttingDown || state.restarting) return { state, action: 'none' };
  if (input.alive) {
    return { state: { ...state, consecutiveFailures: 0 }, action: 'none' };
  }
  // Local child already gone — the exit handler owns that, don't double-count.
  if (!input.childAlive) return { state, action: 'none' };

  const consecutiveFailures = state.consecutiveFailures + 1;
  if (consecutiveFailures >= SUPERVISOR_LIMITS.MAX_CONSECUTIVE_FAILURES) {
    return { state: { ...state, consecutiveFailures: 0 }, action: 'restart' };
  }
  return { state: { ...state, consecutiveFailures }, action: 'warn' };
}

export type RestartAction = 'noop' | 'restart' | 'shutdown-cap';

/**
 * Decide whether (and how) to restart, given the current time.
 *
 *  - already shutting down / restarting → `noop`;
 *  - a backend stable past the threshold has its restart budget forgiven first;
 *  - over the restart cap → `shutdown-cap` (clears `restarting`, the caller shuts down);
 *  - otherwise → `restart` (sets `restarting`, increments the count).
 */
export function planRestart(
  state: SupervisorState,
  now: number,
): { state: SupervisorState; action: RestartAction } {
  if (state.shuttingDown || state.restarting) return { state, action: 'noop' };

  let restartCount = state.restartCount;
  if (
    state.backendReadyAt > 0 &&
    now - state.backendReadyAt > SUPERVISOR_LIMITS.STABLE_THRESHOLD_MS
  ) {
    restartCount = 0; // stable long enough — forgive the budget
  }

  if (restartCount >= SUPERVISOR_LIMITS.MAX_AUTO_RESTARTS) {
    return {
      state: { ...state, restarting: false, restartCount },
      action: 'shutdown-cap',
    };
  }
  return {
    state: { ...state, restarting: true, restartCount: restartCount + 1 },
    action: 'restart',
  };
}

/** Mark the backend ready: clear the failure counter and stamp the ready time. */
export function onBackendReady(
  state: SupervisorState,
  now: number,
): SupervisorState {
  return { ...state, backendReadyAt: now, consecutiveFailures: 0 };
}

/** Settle the in-flight restart (after a recover attempt resolves). */
export function onRestartSettled(state: SupervisorState): SupervisorState {
  return { ...state, restarting: false };
}
