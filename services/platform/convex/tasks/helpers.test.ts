import { describe, expect, it } from 'vitest';

import { normalizeLabelNames } from './helpers';

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
