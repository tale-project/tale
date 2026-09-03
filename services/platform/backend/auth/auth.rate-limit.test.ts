import { describe, expect, it } from 'vitest';

import { API_KEY_RATE_LIMIT } from './auth.ts';

/**
 * Pins the per-API-key rate-limit window. Better Auth's apiKey plugin measures
 * `timeWindow` in MILLISECONDS (`evaluateRateLimit` compares
 * `now - lastRequest` against it), so the intended 60-second window MUST be
 * expressed as 60_000. The historical bug was `timeWindow: 60` — a 60ms window
 * that reset the counter between virtually every request, leaving API keys
 * effectively unthrottled. This test fails the moment the unit regresses.
 */

describe('API_KEY_RATE_LIMIT', () => {
  it('expresses the 60-second window in milliseconds (not seconds)', () => {
    expect(API_KEY_RATE_LIMIT.timeWindow).toBe(60_000);
    // Guard against a silent revert to the seconds-looking value.
    expect(API_KEY_RATE_LIMIT.timeWindow).not.toBe(60);
  });

  it('caps a key at 100 requests per window and keeps limiting enabled', () => {
    expect(API_KEY_RATE_LIMIT.maxRequests).toBe(100);
    expect(API_KEY_RATE_LIMIT.enabled).toBe(true);
  });

  it('keeps the window at least a second — a sub-second window is the bug', () => {
    // Any value below 1000ms means the window is shorter than a single second,
    // which is the shape of the original defect regardless of the exact number.
    expect(API_KEY_RATE_LIMIT.timeWindow).toBeGreaterThanOrEqual(1_000);
  });
});
