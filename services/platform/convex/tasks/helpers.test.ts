import { describe, expect, it } from 'vitest';

import { isScheduleOrderValid, normalizeLabelNames } from './helpers';

describe('isScheduleOrderValid', () => {
  it('allows either bound to be unset', () => {
    expect(isScheduleOrderValid(undefined, undefined)).toBe(true);
    expect(isScheduleOrderValid(1_000, undefined)).toBe(true);
    expect(isScheduleOrderValid(undefined, 1_000)).toBe(true);
  });

  it('allows start on or before due', () => {
    expect(isScheduleOrderValid(1_000, 1_000)).toBe(true);
    expect(isScheduleOrderValid(1_000, 2_000)).toBe(true);
  });

  it('rejects start after due', () => {
    expect(isScheduleOrderValid(2_000, 1_000)).toBe(false);
  });
});

describe('normalizeLabelNames', () => {
  it('trims, lowercases, and dedupes', () => {
    expect(normalizeLabelNames([' Bug ', 'bug', 'Feature'])).toEqual([
      'bug',
      'feature',
    ]);
  });

  it('returns undefined for empty input', () => {
    expect(normalizeLabelNames(undefined)).toBeUndefined();
    expect(normalizeLabelNames([])).toBeUndefined();
  });

  it('rejects blank names', () => {
    expect(() => normalizeLabelNames(['  '])).toThrow();
  });
});
