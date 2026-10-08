// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createShutdownState, ShutdownInterruption } from './shutdown.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('the process shutdown state', () => {
  it('is quiet until shutdown begins', () => {
    const state = createShutdownState();
    expect(state.shuttingDown).toBe(false);
    expect(state.signal.aborted).toBe(false);
    expect(state.interrupt.aborted).toBe(false);
  });

  it('aborts its signal at once and interrupts only after the grace', () => {
    vi.useFakeTimers();
    const state = createShutdownState();

    state.begin('SIGTERM', 20_000);

    expect(state.shuttingDown).toBe(true);
    expect(state.signal.aborted).toBe(true);
    expect(state.interrupt.aborted).toBe(false);
    vi.advanceTimersByTime(19_999);
    expect(state.interrupt.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(state.interrupt.aborted).toBe(true);
  });

  it('aborts with an interruption, never a plain failure', () => {
    const state = createShutdownState();
    state.begin('SIGTERM', 0);

    expect(state.signal.reason).toBeInstanceOf(ShutdownInterruption);
    expect(state.interrupt.reason).toBeInstanceOf(ShutdownInterruption);
    expect(String(state.interrupt.reason)).toContain('SIGTERM');
  });

  it('counts only the first begin', () => {
    vi.useFakeTimers();
    const state = createShutdownState();

    state.begin('SIGTERM', 10_000);
    state.begin('SIGINT', 0);

    expect(state.interrupt.aborted).toBe(false);
    expect(String(state.signal.reason)).toContain('SIGTERM');
    vi.advanceTimersByTime(10_000);
    expect(state.interrupt.aborted).toBe(true);
  });
});
