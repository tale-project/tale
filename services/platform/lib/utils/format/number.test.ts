import { describe, expect, it } from 'vitest';

import { formatBytes, formatPercentShare } from './number';

describe('formatBytes', () => {
  it('picks the unit and one decimal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1073741824)).toBe('1 GB');
    expect(formatBytes(5 * 1024 ** 4)).toBe('5 TB');
  });

  it('follows the active locale', () => {
    expect(formatBytes(1536, 'de')).toBe('1,5 KB');
  });

  it('renders an em dash for a value that is not a size', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('never runs out of units or produces a fraction of a byte', () => {
    expect(formatBytes(0.5)).toBe('0 B');
    expect(formatBytes(5 * 1024 ** 6)).toBe('5,120 PB');
  });
});

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
