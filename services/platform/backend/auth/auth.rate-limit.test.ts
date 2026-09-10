import { describe, expect, it } from 'vitest';

import { API_KEY_RATE_LIMIT } from './auth.ts';

/**
 * Keeps the legacy key window disabled: REST uses the platform token buckets.
 * Its dormant defaults still use the correct units. Better Auth measures
 * `timeWindow` in MILLISECONDS (`evaluateRateLimit` compares
 * `now - lastRequest` against it), so the intended 60-second window MUST be
 * expressed as 60_000. The historical bug was `timeWindow: 60` — a 60ms window
 * that reset the counter between virtually every request. This test also
 * prevents re-enabling the incompatible idle-reset window.
 */

describe('API_KEY_RATE_LIMIT', () => {
  it('expresses the 60-second window in milliseconds (not seconds)', () => {
    expect(API_KEY_RATE_LIMIT.timeWindow).toBe(60_000);
    // Guard against a silent revert to the seconds-looking value.
    expect(API_KEY_RATE_LIMIT.timeWindow).not.toBe(60);
  });

  it('disables the idle-reset window in favor of the platform token buckets', () => {
    expect(API_KEY_RATE_LIMIT.maxRequests).toBe(100);
    expect(API_KEY_RATE_LIMIT.enabled).toBe(false);
  });

  it('keeps the window at least a second — a sub-second window is the bug', () => {
    // Any value below 1000ms means the window is shorter than a single second,
    // which is the shape of the original defect regardless of the exact number.
    expect(API_KEY_RATE_LIMIT.timeWindow).toBeGreaterThanOrEqual(1_000);
  });
});
