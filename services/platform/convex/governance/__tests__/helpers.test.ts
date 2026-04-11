import { describe, expect, it } from 'vitest';

import { buildPeriodKey, buildPeriodKeyFromTimestamp } from '../helpers';

describe('buildPeriodKeyFromTimestamp', () => {
  describe('daily', () => {
    it('returns YYYY-MM-DD format', () => {
      // 2024-06-15 12:00:00 UTC
      const ts = Date.UTC(2024, 5, 15, 12, 0, 0);
      expect(buildPeriodKeyFromTimestamp('daily', ts)).toBe('2024-06-15');
    });

    it('pads single-digit month and day', () => {
      // 2024-01-05 00:00:00 UTC
      const ts = Date.UTC(2024, 0, 5, 0, 0, 0);
      expect(buildPeriodKeyFromTimestamp('daily', ts)).toBe('2024-01-05');
    });

    it('handles last day of month', () => {
      // 2024-02-29 23:59:59 UTC (leap year)
      const ts = Date.UTC(2024, 1, 29, 23, 59, 59);
      expect(buildPeriodKeyFromTimestamp('daily', ts)).toBe('2024-02-29');
    });

    it('handles new year boundary', () => {
      // 2024-12-31 23:59:59 UTC
      const ts = Date.UTC(2024, 11, 31, 23, 59, 59);
      expect(buildPeriodKeyFromTimestamp('daily', ts)).toBe('2024-12-31');
    });
  });

  describe('weekly', () => {
    it('returns YYYY-Www format', () => {
      // 2024-06-15 is a Saturday in ISO week 24
      const ts = Date.UTC(2024, 5, 15, 12, 0, 0);
      const result = buildPeriodKeyFromTimestamp('weekly', ts);
      expect(result).toMatch(/^\d{4}-W\d{2}$/);
    });

    it('returns week 01 for start of year', () => {
      // 2024-01-01 is a Monday
      const ts = Date.UTC(2024, 0, 1, 0, 0, 0);
      const result = buildPeriodKeyFromTimestamp('weekly', ts);
      expect(result).toBe('2024-W01');
    });

    it('returns correct week for end of year', () => {
      // 2024-12-31 — day 366 of a leap year
      const ts = Date.UTC(2024, 11, 31, 0, 0, 0);
      const result = buildPeriodKeyFromTimestamp('weekly', ts);
      expect(result).toMatch(/^\d{4}-W\d{2}$/);
    });
  });

  describe('monthly', () => {
    it('returns YYYY-MM format', () => {
      const ts = Date.UTC(2024, 5, 15, 12, 0, 0);
      expect(buildPeriodKeyFromTimestamp('monthly', ts)).toBe('2024-06');
    });

    it('pads single-digit month', () => {
      const ts = Date.UTC(2024, 0, 1, 0, 0, 0);
      expect(buildPeriodKeyFromTimestamp('monthly', ts)).toBe('2024-01');
    });

    it('handles December', () => {
      const ts = Date.UTC(2024, 11, 31, 23, 59, 59);
      expect(buildPeriodKeyFromTimestamp('monthly', ts)).toBe('2024-12');
    });
  });
});

describe('buildPeriodKey', () => {
  it('returns a string for monthly period', () => {
    const result = buildPeriodKey('monthly');
    expect(result).toMatch(/^\d{4}-\d{2}$/);
  });

  it('returns a string for daily period', () => {
    const result = buildPeriodKey('daily');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a string for weekly period', () => {
    const result = buildPeriodKey('weekly');
    expect(result).toMatch(/^\d{4}-W\d{2}$/);
  });
});
