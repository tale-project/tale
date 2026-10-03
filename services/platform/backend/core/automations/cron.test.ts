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

import {
  cronMatches,
  dueOccurrence,
  firstOccurrenceBetween,
  parseCron,
  wallClockIn,
} from './cron.ts';

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

/**
 * The five Europe/Zurich cadences a team of project agents runs on
 * (`task.start_agent` schedules): a minute scanner fires each slot once per
 * local day — across the October fall-back, when 02:00–02:59 happens twice,
 * and the March spring-forward, when it never happens — because none of
 * them names the 02:00 hour; and a scanner back from an outage fires the
 * latest missed slot once, never the backlog.
 */
describe('dueOccurrence — Europe/Zurich cadences across daylight-saving changes', () => {
  const ZONE = 'Europe/Zurich';
  const MINUTE = 60_000;
  const cadences: Array<[string, string, string[]]> = [
    [
      'fleet manager',
      '0 0,3,6,9,12,15,18,21 * * *',
      ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'],
    ],
    [
      'local QA',
      '15 0,4,8,12,16,20 * * *',
      ['00:15', '04:15', '08:15', '12:15', '16:15', '20:15'],
    ],
    [
      'review and merge',
      '45 0,3,6,9,12,15,18,21 * * *',
      ['00:45', '03:45', '06:45', '09:45', '12:45', '15:45', '18:45', '21:45'],
    ],
    [
      'release and verification',
      '30 1,5,9,13,17,21 * * *',
      ['01:30', '05:30', '09:30', '13:30', '17:30', '21:30'],
    ],
    ['performance', '15 3,11,19 * * *', ['03:15', '11:15', '19:15']],
  ];
  /** Local wall-clock label of an instant in Zurich. */
  const local = (at: number): { day: string; time: string } => {
    const clock = wallClockIn(at, ZONE);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(at));
    const pad = (value: number) => String(value).padStart(2, '0');
    return { day: parts, time: `${pad(clock.hour)}:${pad(clock.minute)}` };
  };
  /** Run a scanner every minute from `from` to `to`; collect the fires. */
  const scan = (expression: string, from: number, to: number): number[] => {
    const fired: number[] = [];
    let since = from - MINUTE;
    for (let now = from; now < to; now += MINUTE) {
      const due = dueOccurrence(expression, ZONE, since, now + 30_000);
      if (due !== null) {
        fired.push(due);
        since = due;
      }
    }
    return fired;
  };
  // Midnight-to-midnight local days, as UTC instants: an ordinary day, the
  // fall-back day (25 hours) and the spring-forward day (23 hours).
  const days: Array<[string, number, number]> = [
    [
      'an ordinary day',
      Date.UTC(2026, 9, 19, 22, 0),
      Date.UTC(2026, 9, 20, 22, 0),
    ],
    [
      'the fall-back day',
      Date.UTC(2026, 9, 24, 22, 0),
      Date.UTC(2026, 9, 25, 23, 0),
    ],
    [
      'the spring-forward day',
      Date.UTC(2027, 2, 27, 23, 0),
      Date.UTC(2027, 2, 28, 22, 0),
    ],
  ];

  it.each(
    cadences.flatMap(([role, expression, slots]) =>
      days.map(
        ([label, from, to]) =>
          [role, label, expression, slots, from, to] as const,
      ),
    ),
  )(
    'the %s cadence fires each slot once on %s',
    (_role, _label, expression, slots, from, to) => {
      const fired = scan(expression, from, to);
      const times = fired.map((at) => local(at).time);
      expect(times).toEqual(slots);
      expect(new Set(fired.map((at) => local(at).day)).size).toBe(1);
      expect(times.some((time) => time.startsWith('02:'))).toBe(false);
    },
  );

  it('fires only the latest missed slot after an outage, never the backlog', () => {
    // The scanner is down from 20:50 to 22:20 local on an ordinary day: the
    // fleet manager's 21:00 slot lies inside the catch-up hour of the first
    // scan back only when that scan comes within the hour; at 22:20 it does
    // not, so nothing fires until the next slot.
    const expression = '0 0,3,6,9,12,15,18,21 * * *';
    const before = Date.UTC(2026, 9, 20, 18, 50); // 20:50 Zurich (CEST)
    const back = Date.UTC(2026, 9, 20, 20, 20); // 22:20 Zurich
    expect(dueOccurrence(expression, ZONE, before, back)).toBeNull();
    // Back at 21:40 instead: one fire, for 21:00, and none again after it.
    const soon = Date.UTC(2026, 9, 20, 19, 40);
    const due = dueOccurrence(expression, ZONE, before, soon);
    expect(due).toBe(Date.UTC(2026, 9, 20, 19, 0));
    expect(dueOccurrence(expression, ZONE, due ?? 0, soon + MINUTE)).toBeNull();
    // A QA scanner that was away for five hours fires once, for the latest
    // slot within the hour, never for the 16:15 it also missed.
    const qa = '15 0,4,8,12,16,20 * * *';
    expect(
      dueOccurrence(
        qa,
        ZONE,
        Date.UTC(2026, 9, 20, 13, 0),
        Date.UTC(2026, 9, 20, 18, 30),
      ),
    ).toBe(Date.UTC(2026, 9, 20, 18, 15));
  });
});

describe('firstOccurrenceBetween', () => {
  const ZONE = 'Europe/Zurich';

  it('finds the slot right after a spring-forward gap, as the scan fires it', () => {
    // 01:59 CET on 28 March 2027; 02:00 jumps to 03:00 CEST.
    const from = Date.UTC(2027, 2, 28, 0, 59);
    const schedule = parseCron('0 0,3,6,9,12,15,18,21 * * *');
    const next = firstOccurrenceBetween(
      schedule,
      ZONE,
      from,
      from + 86_400_000,
    );
    expect(next).toBe(Date.UTC(2027, 2, 28, 1, 0)); // 03:00 CEST
    expect(next !== null && cronMatches(schedule, next, ZONE)).toBe(true);
  });

  it('skips days and hours no field admits, and answers null past the window', () => {
    const schedule = parseCron('30 8 1 * *'); // 08:30 on the 1st
    const from = Date.UTC(2026, 9, 2, 12, 0); // 2 October
    expect(
      firstOccurrenceBetween(schedule, 'UTC', from, from + 40 * 86_400_000),
    ).toBe(Date.UTC(2026, 10, 1, 8, 30));
    expect(
      firstOccurrenceBetween(schedule, 'UTC', from, from + 20 * 86_400_000),
    ).toBeNull();
  });

  it('never answers the minute it starts from', () => {
    const at = Date.UTC(2026, 8, 12, 10, 0);
    expect(
      firstOccurrenceBetween(parseCron('* * * * *'), 'UTC', at, at + 60_000),
    ).toBe(at + 60_000);
  });
});
