// @vitest-environment node

/**
 * The cron matcher's parse contract (trigger-delivery class): a five-field
 * expression is refused at PARSE for anything that can never fire — a field
 * out of range, a range with an end missing, and a day-of-month no month it
 * names can reach — so the bind door answers 400 instead of saving a
 * schedule that ticks forever without an occurrence. The feasibility rule
 * itself lives in `lib/automations/cron-feasibility.ts`, shared with the
 * editor's preview.
 */

import { describe, expect, it } from 'vitest';

import { cronMatches, dueOccurrence, parseCron, wallClockIn } from './cron.ts';

describe('parseCron feasibility', () => {
  it.each([
    ['0 0 31 * *', 'the 31st of every month that has one'],
    ['0 0 29 2 *', 'February 29 — the leap day'],
    ['0 0 31 4,5 *', 'the 31st in April or May: May has one'],
    ['0 0 30 2 1', 'the 30th OR Mondays in February — crontab’s either rule'],
    ['0 0 1-31 2 *', 'a range that reaches days February has'],
    ['0 0 * 2 *', 'every day of February'],
    ['0 9 * * 1-5', 'weekdays'],
  ])('accepts %s (%s)', (expression) => {
    expect(() => parseCron(expression)).not.toThrow();
  });

  it.each([
    ['0 0 30 2 *', 'day-of-month 30 never occurs in month 2'],
    ['0 0 31 2 *', 'day-of-month 31 never occurs in month 2'],
    ['0 0 31 4 *', 'day-of-month 31 never occurs in month 4'],
    ['0 0 31 4,6,9,11 *', 'day-of-month 31 never occurs in months 4, 6, 9, 11'],
    ['0 0 30,31 2 *', 'day-of-month 30, 31 never occurs in month 2'],
  ])('refuses %s, naming the pair', (expression, sentence) => {
    expect(() => parseCron(expression)).toThrowError(sentence);
  });

  it('never matches the minute the refused expressions would have named', () => {
    // The refusal is a fact about the matcher, not a guess: February 30
    // does not exist, so the day-of-month 30 in month 2 matches no instant.
    const schedule = parseCron('0 0 30 3 *');
    expect(cronMatches(schedule, Date.UTC(2026, 2, 30, 0, 0), 'UTC')).toBe(
      true,
    );
    expect(cronMatches(schedule, Date.UTC(2026, 1, 28, 0, 0), 'UTC')).toBe(
      false,
    );
  });
});

describe('parseCron ranges', () => {
  it.each([
    ['-5 * * * *', '"-5" is not a range'],
    ['5- * * * *', '"5-" is not a range'],
    ['* * 1-2-3 * *', '"1-2-3" is not a range'],
  ])(
    'refuses %s instead of reading a missing end as the floor',
    (expression, sentence) => {
      // `Number('')` is 0: `-5` used to parse as `0-5`.
      expect(() => parseCron(expression)).toThrowError(sentence);
    },
  );

  it('keeps accepting a spelled-out range and a stepped one', () => {
    expect(parseCron('0-5 * * * *').minute.values).toEqual(
      new Set([0, 1, 2, 3, 4, 5]),
    );
    expect(parseCron('0-10/5 * * * *').minute.values).toEqual(
      new Set([0, 5, 10]),
    );
  });

  it('still refuses a field out of range and a wrong field count', () => {
    expect(() => parseCron('60 * * * *')).toThrowError('out of range');
    expect(() => parseCron('* * * *')).toThrowError('5 fields');
  });
});

describe('wallClockIn', () => {
  it('resolves the same instant through the cached formatter', () => {
    const at = Date.UTC(2026, 8, 12, 7, 30);
    const first = wallClockIn(at, 'Europe/Zurich');
    const second = wallClockIn(at, 'Europe/Zurich');
    expect(first).toEqual(second);
    expect(first).toEqual({
      minute: 30,
      hour: 9,
      dayOfMonth: 12,
      month: 9,
      dayOfWeek: 6,
    });
  });

  it('throws for a zone Intl does not know, and caches nothing for it', () => {
    expect(() => wallClockIn(Date.now(), 'Mars/Olympus_Mons')).toThrow();
    expect(() => wallClockIn(Date.now(), 'Mars/Olympus_Mons')).toThrow();
  });
});

describe('dueOccurrence', () => {
  it('finds the most recent occurrence after `since`, bounded by the catch-up window', () => {
    const now = Date.UTC(2026, 8, 12, 10, 0, 30);
    // Every minute: the current minute's floor is due.
    expect(dueOccurrence('* * * * *', 'UTC', now - 120_000, now)).toBe(
      Date.UTC(2026, 8, 12, 10, 0),
    );
    // Nothing newer than `since`.
    expect(
      dueOccurrence('* * * * *', 'UTC', Date.UTC(2026, 8, 12, 10, 0), now),
    ).toBeNull();
  });
});
