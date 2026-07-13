import { describe, expect, it } from 'vitest';

import { formatPercentShare } from './number';

describe('formatPercentShare', () => {
  it('formats a part-of-total share with up to one decimal', () => {
    expect(formatPercentShare(3, 4)).toBe('75%');
    expect(formatPercentShare(1, 3)).toBe('33.3%');
  });

  it('follows the active locale', () => {
    // de uses a decimal comma and a narrow space before the percent sign.
    expect(formatPercentShare(1, 3, 'de')).toMatch(/^33,3\s?%$/);
  });

  it('renders an em dash for an empty total (no data, not 0%)', () => {
    expect(formatPercentShare(0, 0)).toBe('—');
  });
});
