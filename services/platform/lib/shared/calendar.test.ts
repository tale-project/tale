// @vitest-environment node

/**
 * The zone-free day arithmetic repeating tasks and automation schedules
 * share: the clamps that keep a monthly 31st and a yearly February 29 from
 * skipping a period, Monday-first weeks, and the ISO day text a schedule's
 * start date is written in.
 */

import { describe, expect, it } from 'vitest';

import {
  addDays,
  type CalendarDate,
  clampedDate,
  compareDates,
  daysBetween,
  daysInMonth,
  firstRuleDay,
  formatIsoDate,
  isoIndex,
  mondayOf,
  monthsBetween,
  parseIsoDate,
  stepAfter,
  toUtc,
  weekdayOf,
} from './calendar.ts';

const d = (year: number, month: number, day: number): CalendarDate => ({
  year,
  month,
  day,
});

describe('clampedDate', () => {
  it('clamps a 31st to the last day of a short month', () => {
    expect(clampedDate(2026, 4, 31)).toEqual(d(2026, 4, 30));
    expect(clampedDate(2026, 2, 31)).toEqual(d(2026, 2, 28));
    expect(clampedDate(2028, 2, 31)).toEqual(d(2028, 2, 29));
  });

  it('lands February 29 on the 28th in a common year', () => {
    expect(clampedDate(2027, 2, 29)).toEqual(d(2027, 2, 28));
    expect(clampedDate(2028, 2, 29)).toEqual(d(2028, 2, 29));
  });

  it('rolls a month past December (or before January) into the year', () => {
    expect(clampedDate(2026, 13, 5)).toEqual(d(2027, 1, 5));
    expect(clampedDate(2026, 26, 31)).toEqual(d(2028, 2, 29));
    expect(clampedDate(2026, 0, 15)).toEqual(d(2025, 12, 15));
  });
});

describe('day arithmetic', () => {
  it('adds days across a month and a year, and counts them back', () => {
    expect(addDays(d(2026, 12, 30), 3)).toEqual(d(2027, 1, 2));
    expect(addDays(d(2026, 3, 1), -1)).toEqual(d(2026, 2, 28));
    expect(daysBetween(d(2026, 1, 1), d(2027, 1, 1))).toBe(365);
    expect(daysBetween(d(2028, 3, 1), d(2028, 2, 28))).toBe(-2);
  });

  it('reads weekdays as Date#getDay and weeks as Monday first', () => {
    // 2026-10-05 is a Monday; 2026-10-11 a Sunday.
    expect(weekdayOf(d(2026, 10, 5))).toBe(1);
    expect(weekdayOf(d(2026, 10, 11))).toBe(0);
    expect(isoIndex(1)).toBe(0);
    expect(isoIndex(0)).toBe(6);
    expect(mondayOf(d(2026, 10, 11))).toEqual(d(2026, 10, 5));
    expect(mondayOf(d(2026, 10, 5))).toEqual(d(2026, 10, 5));
    expect(mondayOf(d(2026, 1, 1))).toEqual(d(2025, 12, 29));
  });

  it('knows the days in each month, leap Februaries included', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('orders days and counts calendar months between them', () => {
    expect(compareDates(d(2026, 1, 2), d(2026, 1, 3))).toBeLessThan(0);
    expect(compareDates(d(2026, 1, 3), d(2026, 1, 3))).toBe(0);
    expect(compareDates(d(2027, 1, 1), d(2026, 12, 31))).toBeGreaterThan(0);
    expect(monthsBetween(d(2026, 1, 31), d(2026, 2, 1))).toBe(1);
    expect(monthsBetween(d(2026, 11, 5), d(2027, 2, 5))).toBe(3);
    expect(monthsBetween(d(2027, 2, 5), d(2026, 11, 5))).toBe(-3);
  });

  it('refuses a day no Date can hold', () => {
    expect(() => toUtc(d(275761, 1, 1))).toThrow(
      'The repeat date is outside the supported calendar range',
    );
    expect(() => addDays(d(275760, 9, 13), 1)).toThrow(RangeError);
  });
});

describe('stepAfter', () => {
  it('takes the rest of the week first, then skips the interval', () => {
    // Wednesday 2026-10-07, every 2 weeks on Tuesday and Thursday.
    const rule = {
      frequency: 'weekly',
      interval: 2,
      weekdays: [2, 4],
    } as const;
    const thursday = stepAfter(rule, d(2026, 10, 7));
    expect(thursday).toEqual(d(2026, 10, 8));
    expect(stepAfter(rule, thursday)).toEqual(d(2026, 10, 20));
  });

  it('keeps a monthly 31st after a short month clamps one occurrence', () => {
    const rule = { frequency: 'monthly', interval: 1, monthDay: 31 } as const;
    const february = stepAfter(rule, d(2026, 1, 31));
    expect(february).toEqual(d(2026, 2, 28));
    expect(stepAfter(rule, february)).toEqual(d(2026, 3, 31));
  });

  it('steps a yearly February 29 through common years to the leap day', () => {
    const rule = {
      frequency: 'yearly',
      interval: 1,
      month: 2,
      monthDay: 29,
    } as const;
    expect(stepAfter(rule, d(2028, 2, 29))).toEqual(d(2029, 2, 28));
    expect(stepAfter(rule, d(2031, 2, 28))).toEqual(d(2032, 2, 29));
  });
});

describe('firstRuleDay', () => {
  it('is the first named day on or after the date, the step ignored', () => {
    expect(
      firstRuleDay(
        { frequency: 'weekly', interval: 2, weekdays: [1] },
        d(2026, 10, 5),
      ),
    ).toEqual(d(2026, 10, 5));
    expect(
      firstRuleDay(
        { frequency: 'monthly', interval: 2, monthDay: 5 },
        d(2026, 10, 8),
      ),
    ).toEqual(d(2026, 11, 5));
    expect(
      firstRuleDay({ frequency: 'daily', interval: 3 }, d(2026, 10, 8)),
    ).toEqual(d(2026, 10, 8));
    expect(
      firstRuleDay(
        { frequency: 'yearly', interval: 1, month: 2, monthDay: 29 },
        d(2026, 3, 1),
      ),
    ).toEqual(d(2027, 2, 28));
  });
});

describe('ISO day text', () => {
  it('reads and writes YYYY-MM-DD', () => {
    expect(parseIsoDate('2026-10-08')).toEqual(d(2026, 10, 8));
    expect(parseIsoDate('2028-02-29')).toEqual(d(2028, 2, 29));
    expect(formatIsoDate(d(2026, 1, 5))).toBe('2026-01-05');
    expect(formatIsoDate(d(987, 12, 31))).toBe('0987-12-31');
  });

  it.each([
    '2026-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-1-5',
    ' 2026-01-05',
    '2026/01/05',
    '',
  ])('refuses %j, which names no calendar day', (text) => {
    expect(parseIsoDate(text)).toBeNull();
  });
});
