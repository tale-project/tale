import { describe, expect, test } from 'bun:test';

import { msSince, notAhead } from './wall-clock.ts';

describe('msSince', () => {
  test('is the time elapsed since a past moment', () => {
    expect(msSince(1_000, 1_000)).toBe(0);
    expect(msSince(1_000, 4_500)).toBe(3_500);
  });

  test('reads a moment ahead of the clock, after a step back, as long past', () => {
    expect(msSince(10 * 60_000, 60_000)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('notAhead', () => {
  test('keeps a past moment', () => {
    expect(notAhead(1_000, 4_500)).toBe(1_000);
  });

  test('brings a moment ahead of the clock, after a step back, to now', () => {
    expect(notAhead(10 * 60_000, 60_000)).toBe(60_000);
  });
});
