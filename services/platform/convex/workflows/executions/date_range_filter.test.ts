import { describe, expect, it } from 'vitest';

import { parseExecutionDateBounds } from './date_range_filter';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('parseExecutionDateBounds', () => {
  it('returns undefined bounds when no dates are provided', () => {
    expect(parseExecutionDateBounds()).toEqual({
      fromDate: undefined,
      toDate: undefined,
    });
  });

  it('parses full ISO instants directly without adjustment', () => {
    const from = '2026-06-24T00:00:00.000Z';
    const to = '2026-06-24T23:59:59.999Z';

    expect(parseExecutionDateBounds(from, to)).toEqual({
      fromDate: new Date(from).getTime(),
      toDate: new Date(to).getTime(),
    });
  });

  it('includes runs throughout the end day for a full end-of-day instant', () => {
    const { toDate } = parseExecutionDateBounds(
      undefined,
      '2026-06-24T23:59:59.999Z',
    );
    const middayRun = new Date('2026-06-24T07:30:00.000Z').getTime();

    // The regression: a midday run must satisfy `startedAt <= toDate`.
    expect(middayRun <= (toDate ?? 0)).toBe(true);
  });

  it('expands a bare YYYY-MM-DD end date to the last ms of that UTC day', () => {
    const { fromDate, toDate } = parseExecutionDateBounds(
      '2026-06-24',
      '2026-06-24',
    );
    const utcMidnight = new Date('2026-06-24').getTime();

    expect(fromDate).toBe(utcMidnight);
    expect(toDate).toBe(utcMidnight + DAY_MS - 1);
  });

  it('includes a midday run on a bare end date (issue #2075 regression)', () => {
    const { toDate } = parseExecutionDateBounds(undefined, '2026-06-24');
    const middayRun = new Date('2026-06-24T07:30:00.000Z').getTime();

    // Before the fix this collapsed to UTC midnight and excluded the run.
    expect(middayRun <= (toDate ?? 0)).toBe(true);
  });

  it('ignores invalid date strings', () => {
    expect(parseExecutionDateBounds('not-a-date', 'also-bad')).toEqual({
      fromDate: undefined,
      toDate: undefined,
    });
  });
});
