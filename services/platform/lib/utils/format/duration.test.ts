import { describe, expect, it } from 'vitest';

import {
  formatDurationSeconds,
  formatDurationWords,
  formatSuccessRate,
} from './duration';

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

describe('formatDurationWords', () => {
  it('says a limit in the largest unit that reads well', () => {
    expect(formatDurationWords(250, 'en')).toBe('250 milliseconds');
    expect(formatDurationWords(5000, 'en')).toBe('5 seconds');
    expect(formatDurationWords(1000, 'en')).toBe('1 second');
    expect(formatDurationWords(90_000, 'en')).toBe('1.5 minutes');
  });

  it('follows the locale', () => {
    expect(formatDurationWords(5000, 'de')).toBe('5 Sekunden');
    expect(formatDurationWords(90_000, 'de')).toBe('1,5 Minuten');
    // French keeps the number and its unit together with a no-break space.
    expect(formatDurationWords(5000, 'fr')).toBe('5\u00a0secondes');
  });
});
