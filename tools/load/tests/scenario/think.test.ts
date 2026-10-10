import { describe, expect, test } from 'bun:test';

import { mulberry32 } from '../../src/runner/assign.ts';
import {
  MAX_PAUSE_MS,
  pauseMs,
  readingMs,
  retryAfterMs,
  sleep,
  typingMs,
} from '../../src/scenario/think.ts';

describe('think times', () => {
  test('pauses scale linearly with the think-time factor', () => {
    const slow = pauseMs(mulberry32(1), 'read', 1);
    const fast = pauseMs(mulberry32(1), 'read', 0.1);
    expect(fast).toBeCloseTo(slow / 10, 6);
    expect(pauseMs(mulberry32(1), 'idle', 0)).toBe(0);
  });

  test('a tail draw never parks a user past the cap', () => {
    const random = mulberry32(2);
    for (let i = 0; i < 5_000; i += 1) {
      expect(pauseMs(random, 'idle', 50)).toBeLessThanOrEqual(MAX_PAUSE_MS);
    }
  });

  test('reading a long reply takes longer than a short one', () => {
    const short = readingMs(mulberry32(3), 100, 1);
    const long = readingMs(mulberry32(3), 10_000, 1);
    expect(long).toBeGreaterThan(short);
    // Pastes are pasted, not typed.
    expect(typingMs(mulberry32(4), 15_000, 1)).toBeLessThan(
      typingMs(mulberry32(4), 400, 1),
    );
  });
});

describe('retryAfterMs', () => {
  test('reads delta-seconds and HTTP dates', () => {
    expect(retryAfterMs('3')).toBe(3_000);
    expect(retryAfterMs(' 0 ')).toBe(0);
    const now = Date.parse('2026-10-08T12:00:00Z');
    expect(retryAfterMs('Thu, 08 Oct 2026 12:00:10 GMT', now)).toBe(10_000);
    expect(retryAfterMs(undefined)).toBeNull();
    expect(retryAfterMs('soon')).toBeNull();
  });
});

describe('sleep', () => {
  test('ends early, without rejecting, when the user is stopped', async () => {
    const controller = new AbortController();
    const started = performance.now();
    setTimeout(() => controller.abort(), 20);
    await sleep(10_000, controller.signal);
    expect(performance.now() - started).toBeLessThan(1_000);
    // Already stopped: returns at once.
    await sleep(10_000, controller.signal);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
