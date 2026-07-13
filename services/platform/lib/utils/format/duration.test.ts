import { describe, expect, it } from 'vitest';

import { formatDurationSeconds, formatSuccessRate } from './duration';

describe('formatDurationSeconds', () => {
  it('formats seconds, minutes, and hours compactly', () => {
    expect(formatDurationSeconds(45)).toBe('45s');
    expect(formatDurationSeconds(150)).toBe('2m 30s');
    expect(formatDurationSeconds(120)).toBe('2m');
    expect(formatDurationSeconds(3900)).toBe('1h 5m');
    expect(formatDurationSeconds(3600)).toBe('1h');
  });

  it('clamps zero and negative durations to 0s', () => {
    expect(formatDurationSeconds(0)).toBe('0s');
    expect(formatDurationSeconds(-5)).toBe('0s');
  });
});

describe('formatSuccessRate', () => {
  it('renders one decimal in the default locale', () => {
    expect(formatSuccessRate(120, 98.6)).toBe('98.6%');
    expect(formatSuccessRate(4, 100)).toBe('100.0%');
  });

  it('follows the active locale', () => {
    // de uses a decimal comma and a narrow space before the percent sign.
    expect(formatSuccessRate(120, 98.6, 'de')).toMatch(/^98,6\s?%$/);
  });

  it('renders an em dash when there were no runs to rate', () => {
    expect(formatSuccessRate(0, 0)).toBe('—');
  });
});
