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

  describe('weekly (ISO 8601)', () => {
    it('returns YYYY-Www format for a mid-year Saturday', () => {
      // 2024-06-15 Saturday — ISO week 24
      const ts = Date.UTC(2024, 5, 15, 12, 0, 0);
      expect(buildPeriodKeyFromTimestamp('weekly', ts)).toBe('2024-W24');
    });

    it('returns W01 when Jan 1 is a Monday', () => {
      // 2024-01-01 Monday — ISO says 2024-W01
      const ts = Date.UTC(2024, 0, 1, 0, 0, 0);
      expect(buildPeriodKeyFromTimestamp('weekly', ts)).toBe('2024-W01');
    });

    it('rolls Jan 1 Sunday back into previous year (2023-01-01 → 2022-W52)', () => {
      // 2023-01-01 Sunday — ISO 8601: belongs to week 52 of 2022
      const ts = Date.UTC(2023, 0, 1, 0, 0, 0);
      expect(buildPeriodKeyFromTimestamp('weekly', ts)).toBe('2022-W52');
    });

    it('rolls late-December dates into next year (2024-12-31 Tuesday → 2025-W01)', () => {
      // 2024-12-31 Tuesday — ISO says 2025-W01 (Thursday of that week is 2025-01-02)
      const ts = Date.UTC(2024, 11, 31, 0, 0, 0);
      expect(buildPeriodKeyFromTimestamp('weekly', ts)).toBe('2025-W01');
    });

    it('rolls late-December dates into next year (2025-12-29 Monday → 2026-W01)', () => {
      // 2025-12-29 Monday — ISO says 2026-W01
      const ts = Date.UTC(2025, 11, 29, 0, 0, 0);
      expect(buildPeriodKeyFromTimestamp('weekly', ts)).toBe('2026-W01');
    });

    it('produces zero-padded week numbers for sortable keys', () => {
      // 2024-01-08 Monday — ISO week 2
      const ts = Date.UTC(2024, 0, 8, 0, 0, 0);
      expect(buildPeriodKeyFromTimestamp('weekly', ts)).toBe('2024-W02');
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
