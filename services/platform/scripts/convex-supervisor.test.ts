import { describe, expect, it } from 'vitest';

import {
  initialSupervisorState,
  onConvexReady,
  onHealthTick,
  onRestartSettled,
  planRestart,
  type SupervisorState,
  SUPERVISOR_LIMITS,
} from './convex-supervisor';

const LOCAL = { alive: false, childAlive: true, external: false };

describe('onHealthTick', () => {
  it('warns on the first failures, then asks to restart on the threshold (resetting the counter)', () => {
    const state = initialSupervisorState();
    const r1 = onHealthTick(state, LOCAL);
    expect(r1.action).toBe('warn');
    expect(r1.state.consecutiveFailures).toBe(1);
    const r2 = onHealthTick(r1.state, LOCAL);
    expect(r2.action).toBe('warn');
    expect(r2.state.consecutiveFailures).toBe(2);
    const r3 = onHealthTick(r2.state, LOCAL);
    expect(r3.action).toBe('restart');
    expect(r3.state.consecutiveFailures).toBe(0);
    expect(SUPERVISOR_LIMITS.MAX_CONSECUTIVE_FAILURES).toBe(3);
  });

  it('a live probe resets the consecutive-failure counter', () => {
    let state = initialSupervisorState();
    state = onHealthTick(state, LOCAL).state; // fail #1
    state = onHealthTick(state, LOCAL).state; // fail #2
    const alive = onHealthTick(state, { ...LOCAL, alive: true });
    expect(alive.action).toBe('none');
    expect(alive.state.consecutiveFailures).toBe(0);
    // the next failure is #1 again, not #3
    expect(onHealthTick(alive.state, LOCAL).action).toBe('warn');
  });

  it('does not count a failure when the local child has already exited (double-count guard)', () => {
    const state = initialSupervisorState();
    const r = onHealthTick(state, {
      alive: false,
      childAlive: false,
      external: false,
    });
    expect(r.action).toBe('none');
    expect(r.state.consecutiveFailures).toBe(0);
  });

  it('counts failures in external mode without inspecting a child', () => {
    let state = initialSupervisorState();
    const ext = { alive: false, childAlive: false, external: true };
    const r1 = onHealthTick(state, ext);
    expect(r1.action).toBe('warn');
    state = onHealthTick(r1.state, ext).state;
    expect(onHealthTick(state, ext).action).toBe('restart');
  });

  it('is a no-op while restarting or shutting down', () => {
    const restarting: SupervisorState = {
      ...initialSupervisorState(),
      restarting: true,
    };
    expect(onHealthTick(restarting, LOCAL).action).toBe('none');
    const shutting: SupervisorState = {
      ...initialSupervisorState(),
      shuttingDown: true,
    };
    expect(onHealthTick(shutting, LOCAL).action).toBe('none');
  });
});

describe('planRestart', () => {
  const T0 = 1_000_000;

  it('restarts up to the cap, then asks to shut down', () => {
    let state = initialSupervisorState(); // convexReadyAt=0 → no stable reset
    for (let i = 1; i <= SUPERVISOR_LIMITS.MAX_AUTO_RESTARTS; i++) {
      const r = planRestart(state, T0, { external: false });
      expect(r.action).toBe('restart');
      expect(r.state.restartCount).toBe(i);
      expect(r.state.restarting).toBe(true);
      state = onRestartSettled(r.state); // recover resolves, clears restarting
    }
    const capped = planRestart(state, T0, { external: false });
    expect(capped.action).toBe('shutdown-cap');
    expect(capped.state.restarting).toBe(false);
  });

  it('forgives the restart budget once the backend has been stable past the threshold', () => {
    const state: SupervisorState = {
      ...initialSupervisorState(),
      restartCount: 4,
      convexReadyAt: T0,
    };
    const r = planRestart(
      state,
      T0 + SUPERVISOR_LIMITS.STABLE_THRESHOLD_MS + 1,
      { external: false },
    );
    expect(r.action).toBe('restart');
    expect(r.state.restartCount).toBe(1); // reset to 0, then +1
  });

  it('does NOT forgive just under the stable threshold', () => {
    const state: SupervisorState = {
      ...initialSupervisorState(),
      restartCount: 4,
      convexReadyAt: T0,
    };
    const r = planRestart(
      state,
      T0 + SUPERVISOR_LIMITS.STABLE_THRESHOLD_MS - 1,
      { external: false },
    );
    expect(r.action).toBe('restart');
    expect(r.state.restartCount).toBe(5);
  });

  it('is a no-op for an external backend (not ours to restart)', () => {
    const state = initialSupervisorState();
    const r = planRestart(state, T0, { external: true });
    expect(r.action).toBe('noop-external');
    expect(r.state).toEqual(state);
  });

  it('short-circuits while already restarting or shutting down', () => {
    const restarting: SupervisorState = {
      ...initialSupervisorState(),
      restarting: true,
    };
    expect(planRestart(restarting, T0, { external: false }).action).toBe(
      'noop',
    );
    const shutting: SupervisorState = {
      ...initialSupervisorState(),
      shuttingDown: true,
    };
    expect(planRestart(shutting, T0, { external: false }).action).toBe('noop');
  });
});

describe('onConvexReady / onRestartSettled', () => {
  it('onConvexReady stamps the time and clears failures', () => {
    const state: SupervisorState = {
      ...initialSupervisorState(),
      consecutiveFailures: 2,
    };
    const r = onConvexReady(state, 42);
    expect(r.convexReadyAt).toBe(42);
    expect(r.consecutiveFailures).toBe(0);
  });

  it('onRestartSettled clears the restarting flag', () => {
    const state: SupervisorState = {
      ...initialSupervisorState(),
      restarting: true,
    };
    expect(onRestartSettled(state).restarting).toBe(false);
  });
});
