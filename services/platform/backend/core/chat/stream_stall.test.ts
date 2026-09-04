// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createStallGuard,
  STREAM_STALL_TIMEOUT_MS,
  stallMessage,
} from './stream_stall';

/**
 * The stall guard is a SILENCE clock, not a deadline: activity restarts it,
 * so a stream that keeps producing can run for any length of time, and only
 * a provider that goes quiet for the whole window trips it.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createStallGuard', () => {
  it('never fires while activity keeps arriving, however long the stream runs', () => {
    const guard = createStallGuard(1_000);
    // Ten windows' worth of wall clock, touched just before each deadline.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(999);
      guard.touch();
    }
    expect(guard.signal.aborted).toBe(false);
    expect(guard.stalled).toBe(false);
    guard.dispose();
  });

  it('fires once the provider has been silent for the whole window', () => {
    const guard = createStallGuard(1_000);
    vi.advanceTimersByTime(999);
    expect(guard.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(guard.signal.aborted).toBe(true);
    expect(guard.stalled).toBe(true);
    expect(guard.signal.reason).toBeInstanceOf(Error);
    expect((guard.signal.reason as Error).message).toBe(stallMessage(1_000));
  });

  it('measures silence from the LAST byte, not from the request start', () => {
    const guard = createStallGuard(1_000);
    vi.advanceTimersByTime(800);
    guard.touch();
    // 1.6s since the start — past a fixed deadline, but only 0.8s of silence.
    vi.advanceTimersByTime(800);
    expect(guard.signal.aborted).toBe(false);
    vi.advanceTimersByTime(200);
    expect(guard.signal.aborted).toBe(true);
  });

  it('dispose stops the clock, and a late touch does not re-arm it', () => {
    const guard = createStallGuard(1_000);
    guard.dispose();
    guard.touch();
    vi.advanceTimersByTime(5_000);
    expect(guard.signal.aborted).toBe(false);
    expect(guard.stalled).toBe(false);
  });

  it('names the silence window and the timeout in the surfaced error', () => {
    const guard = createStallGuard(STREAM_STALL_TIMEOUT_MS);
    const error = guard.error(new Error('aborted'));
    expect(error.message).toMatch(/timed out after 180 seconds of silence/);
    expect(error.cause).toBeInstanceOf(Error);
    guard.dispose();
  });
});
