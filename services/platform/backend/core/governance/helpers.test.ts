import { describe, expect, it } from 'vitest';

import {
  buildPeriodEndFromTimestamp,
  buildPeriodKey,
  buildPeriodKeyFromTimestamp,
} from './helpers';

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

describe('buildPeriodEndFromTimestamp', () => {
  it('ends a day at the next UTC midnight', () => {
    const ts = Date.UTC(2026, 8, 15, 13, 45, 0);
    expect(buildPeriodEndFromTimestamp('daily', ts)).toBe(
      Date.UTC(2026, 8, 16),
    );
  });

  it('starts the next day at the boundary itself', () => {
    const ts = Date.UTC(2026, 8, 16, 0, 0, 0);
    expect(buildPeriodEndFromTimestamp('daily', ts)).toBe(
      Date.UTC(2026, 8, 17),
    );
  });

  it('rolls a day over a month and a year end', () => {
    expect(
      buildPeriodEndFromTimestamp('daily', Date.UTC(2024, 1, 29, 23, 59, 59)),
    ).toBe(Date.UTC(2024, 2, 1));
    expect(
      buildPeriodEndFromTimestamp('daily', Date.UTC(2024, 11, 31, 12)),
    ).toBe(Date.UTC(2025, 0, 1));
  });

  it('ends an ISO week at the next Monday midnight', () => {
    // Tuesday 2026-09-15 → Monday 2026-09-21.
    expect(
      buildPeriodEndFromTimestamp('weekly', Date.UTC(2026, 8, 15, 9)),
    ).toBe(Date.UTC(2026, 8, 21));
    // Sunday is the week's last day, not the first of the next.
    expect(
      buildPeriodEndFromTimestamp('weekly', Date.UTC(2026, 8, 20, 23, 59)),
    ).toBe(Date.UTC(2026, 8, 21));
    // Monday midnight already belongs to the new week.
    expect(buildPeriodEndFromTimestamp('weekly', Date.UTC(2026, 8, 21))).toBe(
      Date.UTC(2026, 8, 28),
    );
  });

  it('agrees with the week key across the ISO year boundary', () => {
    // 2024-12-30 is Monday of 2025-W01; its week ends 2025-01-06.
    const ts = Date.UTC(2024, 11, 31, 10);
    const end = buildPeriodEndFromTimestamp('weekly', ts);
    expect(end).toBe(Date.UTC(2025, 0, 6));
    expect(buildPeriodKeyFromTimestamp('weekly', end - 1)).toBe(
      buildPeriodKeyFromTimestamp('weekly', ts),
    );
    expect(buildPeriodKeyFromTimestamp('weekly', end)).toBe('2025-W02');
  });

  it('ends a month on the first of the next, including December', () => {
    expect(
      buildPeriodEndFromTimestamp('monthly', Date.UTC(2026, 8, 15, 13)),
    ).toBe(Date.UTC(2026, 9, 1));
    expect(
      buildPeriodEndFromTimestamp('monthly', Date.UTC(2026, 11, 31, 23, 59)),
    ).toBe(Date.UTC(2027, 0, 1));
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
