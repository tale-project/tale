import { describe, expect, it } from 'vitest';

import {
  clipToDay,
  dayKeyDaysBefore,
  emptyPerStatus,
  isOpenStatus,
  previousUtcDayKey,
  utcDayKey,
  utcDayRange,
} from './rollup_math';

describe('rollup_math', () => {
  it('utcDayKey/utcDayRange round-trip on the UTC day boundary', () => {
    const { startMs, endMs } = utcDayRange('2026-06-10');
    expect(utcDayKey(startMs)).toBe('2026-06-10');
    expect(utcDayKey(endMs - 1)).toBe('2026-06-10');
    expect(utcDayKey(endMs)).toBe('2026-06-11');
    expect(endMs - startMs).toBe(24 * 60 * 60 * 1000);
  });

  it('rejects malformed day keys', () => {
    expect(() => utcDayRange('2026-6-1')).toThrow();
    expect(() => utcDayRange('not-a-day')).toThrow();
  });

  it('previousUtcDayKey crosses month boundaries', () => {
    const { startMs } = utcDayRange('2026-06-01');
    expect(previousUtcDayKey(startMs + 1000)).toBe('2026-05-31');
  });

  it('dayKeyDaysBefore subtracts whole days', () => {
    expect(dayKeyDaysBefore('2026-06-10', 400)).toBe('2025-05-06');
  });

  it('clipToDay returns only the overlap with the day window', () => {
    const { startMs, endMs } = utcDayRange('2026-06-10');
    // Fully inside.
    expect(clipToDay(startMs + 1000, startMs + 5000, startMs, endMs)).toBe(
      4000,
    );
    // Started the previous day: clipped at the day start.
    expect(clipToDay(startMs - 5000, startMs + 5000, startMs, endMs)).toBe(
      5000,
    );
    // Ends after the day: clipped at the day end.
    expect(clipToDay(endMs - 3000, endMs + 9000, startMs, endMs)).toBe(3000);
    // No overlap.
    expect(clipToDay(startMs - 10, startMs - 5, startMs, endMs)).toBe(0);
  });

  it('isOpenStatus excludes terminal states; accumulator covers all four', () => {
    expect(isOpenStatus('in_review')).toBe(true);
    expect(isOpenStatus('done')).toBe(false);
    expect(Object.keys(emptyPerStatus()).sort()).toEqual([
      'backlog',
      'in_progress',
      'in_review',
      'todo',
    ]);
  });
});
