import { describe, expect, it } from 'vitest';

import {
  USAGE_LIMIT_DEFAULT_HOLD_MS,
  USAGE_LIMIT_MAX_HOLD_MS,
  usageLimitHeldUntil,
} from './usage-limit-holds.ts';

describe('how long a sign-in at its usage limit is held [TASK-R87]', () => {
  const now = Date.parse('2026-11-28T10:00:00Z');

  it('until the reset the harness named', () => {
    const reset = Date.parse('2026-11-28T15:45:00Z');
    expect(usageLimitHeldUntil(now, reset)).toEqual({
      heldUntilMs: reset,
      resetKnown: true,
    });
  });

  it('an hour when it named none, or a reset already past', () => {
    for (const reset of [undefined, now - 1, Number.NaN]) {
      expect(usageLimitHeldUntil(now, reset)).toEqual({
        heldUntilMs: now + USAGE_LIMIT_DEFAULT_HOLD_MS,
        resetKnown: false,
      });
    }
  });

  it('never longer than a weekly window and a day', () => {
    expect(usageLimitHeldUntil(now, now + 30 * 24 * 60 * 60_000)).toEqual({
      heldUntilMs: now + USAGE_LIMIT_MAX_HOLD_MS,
      resetKnown: true,
    });
  });
});
