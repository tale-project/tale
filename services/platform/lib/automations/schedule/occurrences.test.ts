// @vitest-environment node

/**
 * When a schedule starts, in both daylight-saving classes: named times
 * (day rules, cron with minute and hour spelled out) move forward over a
 * gap and start once in a repeated hour; grids (minutely and hourly rules,
 * cron starting with `*`) keep their pace in real time. The matrix covers
 * Europe/Zurich, America/New_York, Australia/Lord_Howe (30-minute shifts)
 * and Asia/Kolkata (a half-hour offset, no DST). Day rules are held to the
 * repeating task's own series by a seeded property test.
 */

import {
  gridMinuteAtOrAfter,
  type ScheduleRule,
  windowRangesOn,
} from '@tale/shared/schemas/schedule-rule';
import { describe, expect, it } from 'vitest';

import { firstOccurrenceBetween } from '../../../backend/core/automations/cron.ts';
import type { CalendarDate } from '../../shared/calendar.ts';
import {
  calendarDateIn,
  firstTaskRepeatOccurrence,
  nextTaskRepeatOccurrence,
  startOfCalendarDate,
  type TaskRepeat,
} from '../../shared/task-repeat.ts';
import { localDateIn, wallClockIn } from '../../shared/zoned-time.ts';
import { parseCron } from '../cron.ts';
import {
  countBetween,
  decideDue,
  MISSED_COUNT_CAP,
  nextOccurrence,
  occurrencesAfter,
  previousOccurrence,
  type Schedule,
  scheduleOfTrigger,
  SCHEDULE_ON_TIME_GRACE_MS,
  upcomingOccurrences,
} from './occurrences.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const at = (text: string) => Date.parse(text);
const iso = (ms: number) => new Date(ms).toISOString().replace(':00.000Z', 'Z');
const day = (text: string): CalendarDate => {
  const [year, month, date] = text.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 0, day: date ?? 0 };
};

function rule(
  value: ScheduleRule,
  timezone = 'UTC',
  startDate = '2026-01-01',
): Schedule {
  return { type: 'rule', rule: value, timezone, startDate: day(startDate) };
}

function cron(expression: string, timezone = 'UTC'): Schedule {
  const found = scheduleOfTrigger({
    cron: expression,
    timezone,
    scheduleRule: null,
  });
  if (!('schedule' in found)) throw new Error(found.issue);
  return found.schedule;
}

/** Local wall time of an instant, `HH:MM`. */
function local(ms: number, zone: string): string {
  const clock = wallClockIn(ms, zone);
  return `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;
}

/** Every start in [from, to]. */
function between(schedule: Schedule, from: number, to: number): number[] {
  return occurrencesAfter(schedule, from - 1, 500).filter((ms) => ms <= to);
}

const daily = (times: string[], interval = 1): ScheduleRule => ({
  frequency: 'daily',
  interval,
  times,
});

describe('named times through daylight-saving changes', () => {
  it.each([
    // [zone, the rule's time, asked after, the start, its mark]
    [
      'Europe/Zurich',
      '02:30',
      '2026-03-28T12:00Z',
      '2026-03-29T01:30Z',
      'shiftedForward',
    ],
    [
      'Europe/Zurich',
      '02:30',
      '2026-10-24T12:00Z',
      '2026-10-25T00:30Z',
      'repeatedHour',
    ],
    [
      'America/New_York',
      '02:30',
      '2026-03-07T12:00Z',
      '2026-03-08T07:30Z',
      'shiftedForward',
    ],
    [
      'America/New_York',
      '01:30',
      '2026-10-31T12:00Z',
      '2026-11-01T05:30Z',
      'repeatedHour',
    ],
    [
      'Australia/Lord_Howe',
      '02:15',
      '2026-10-03T00:00Z',
      '2026-10-03T15:45Z',
      'shiftedForward',
    ],
    [
      'Australia/Lord_Howe',
      '01:45',
      '2026-04-04T00:00Z',
      '2026-04-04T14:45Z',
      'repeatedHour',
    ],
  ] as const)(
    '%s daily at %s after %s starts at %s (%s)',
    (zone, time, after, start, mark) => {
      const schedule = rule(daily([time]), zone);
      const [first, second] = upcomingOccurrences(schedule, at(after), 2);
      expect(iso(first?.at ?? 0)).toBe(start);
      expect(first?.clockChange?.kind).toBe(mark);
      if (first?.clockChange?.kind === 'shiftedForward') {
        expect(first.clockChange.wallTime).toBe(time);
      }
      if (first?.clockChange?.kind === 'repeatedHour') {
        expect(first.clockChange.interval).toBe(false);
      }
      // The next day the time exists once again, a day of local time later.
      expect(second?.clockChange).toBeUndefined();
      expect(local(second?.at ?? 0, zone)).toBe(time);
    },
  );

  it('starts a repeated time once, at its first instant', () => {
    const schedule = rule(daily(['02:30']), 'Europe/Zurich');
    expect(
      between(schedule, at('2026-10-24T12:00Z'), at('2026-10-26T12:00Z')).map(
        iso,
      ),
    ).toEqual(['2026-10-25T00:30Z', '2026-10-26T01:30Z']);
  });

  it('keeps Kolkata exactly a day apart, at its half-hour offset', () => {
    const schedule = rule(daily(['02:30']), 'Asia/Kolkata');
    expect(
      occurrencesAfter(schedule, at('2026-03-27T00:00Z'), 3).map(iso),
    ).toEqual(['2026-03-27T21:00Z', '2026-03-28T21:00Z', '2026-03-29T21:00Z']);
  });

  it('starts two times that land on one instant once, unmarked', () => {
    const schedule = rule(daily(['02:30', '03:30']), 'Europe/Zurich');
    const starts = upcomingOccurrences(schedule, at('2026-03-28T12:00Z'), 3);
    expect(starts.map((start) => iso(start.at))).toEqual([
      '2026-03-29T01:30Z',
      '2026-03-30T00:30Z',
      '2026-03-30T01:30Z',
    ]);
    expect(starts[0]?.clockChange).toBeUndefined();
    expect(starts[0]?.timeZone).toBe('Europe/Zurich');
  });

  it('reads a named cron the same way', () => {
    const schedule = cron('30 2 * * *', 'Europe/Zurich');
    expect(
      occurrencesAfter(schedule, at('2026-03-28T12:00Z'), 1).map(iso),
    ).toEqual(['2026-03-29T01:30Z']);
    expect(
      between(schedule, at('2026-10-24T12:00Z'), at('2026-10-25T23:00Z')).map(
        iso,
      ),
    ).toEqual(['2026-10-25T00:30Z']);
  });
});

describe('grids through daylight-saving changes', () => {
  const quarterHour: ScheduleRule = { frequency: 'minutely', interval: 15 };

  it('runs the repeated hour twice, 15 real minutes apart', () => {
    const schedule = rule(quarterHour, 'Europe/Zurich');
    const starts = between(
      schedule,
      at('2026-10-25T00:00Z'),
      at('2026-10-25T02:00Z'),
    );
    expect(starts).toHaveLength(9);
    expect(starts.slice(1).map((ms, i) => ms - (starts[i] ?? 0))).toEqual(
      Array.from({ length: 8 }, () => 15 * MINUTE),
    );
    expect(starts.map((ms) => local(ms, 'Europe/Zurich'))).toEqual([
      '02:00',
      '02:15',
      '02:30',
      '02:45',
      '02:00',
      '02:15',
      '02:30',
      '02:45',
      '03:00',
    ]);
    const marked = upcomingOccurrences(
      schedule,
      at('2026-10-25T00:00Z') - 1,
      9,
    );
    expect(marked.map((start) => start.clockChange)).toEqual([
      ...Array.from({ length: 8 }, () => ({
        kind: 'repeatedHour',
        interval: true,
      })),
      undefined,
    ]);
  });

  it('skips the minutes the clock jumps over and keeps the pace', () => {
    const schedule = rule(quarterHour, 'Europe/Zurich');
    const starts = between(
      schedule,
      at('2026-03-29T00:00Z'),
      at('2026-03-29T02:00Z'),
    );
    expect(starts.map((ms) => local(ms, 'Europe/Zurich'))).toEqual([
      '01:00',
      '01:15',
      '01:30',
      '01:45',
      '03:00',
      '03:15',
      '03:30',
      '03:45',
      '04:00',
    ]);
    expect(
      upcomingOccurrences(schedule, at('2026-03-29T00:30Z'), 3).map(
        (s) => s.clockChange,
      ),
    ).toEqual([undefined, undefined, undefined]);
  });

  it('runs hourly at :30 through a fall-back at one-hour pace', () => {
    const schedule = rule(
      { frequency: 'hourly', interval: 1, minute: 30 },
      'Europe/Zurich',
    );
    expect(
      between(schedule, at('2026-10-24T23:00Z'), at('2026-10-25T03:00Z')).map(
        iso,
      ),
    ).toEqual([
      '2026-10-24T23:30Z',
      '2026-10-25T00:30Z',
      '2026-10-25T01:30Z',
      '2026-10-25T02:30Z',
    ]);
  });

  it('runs a New York half-hour grid through its fall-back', () => {
    const schedule = rule(
      { frequency: 'minutely', interval: 30 },
      'America/New_York',
    );
    expect(
      between(schedule, at('2026-11-01T05:00Z'), at('2026-11-01T07:00Z')).map(
        (ms) => local(ms, 'America/New_York'),
      ),
    ).toEqual(['01:00', '01:30', '01:00', '01:30', '02:00']);
  });

  it('jumps a 30-minute Lord Howe gap: 02:00 and 02:20 never exist', () => {
    const schedule = rule(
      { frequency: 'minutely', interval: 20 },
      'Australia/Lord_Howe',
    );
    expect(
      between(schedule, at('2026-10-03T14:10Z'), at('2026-10-03T16:20Z')).map(
        iso,
      ),
    ).toEqual([
      '2026-10-03T14:10Z',
      '2026-10-03T14:30Z',
      '2026-10-03T14:50Z',
      '2026-10-03T15:10Z',
      '2026-10-03T15:40Z',
      '2026-10-03T16:00Z',
      '2026-10-03T16:20Z',
    ]);
  });

  it('runs a Lord Howe grid twice through its repeated half hour', () => {
    const schedule = rule(
      { frequency: 'minutely', interval: 20 },
      'Australia/Lord_Howe',
    );
    // 02:00 (+11) falls back to 01:30 (+10:30) at 15:00Z: 01:30 is off the
    // grid, and 01:40 comes again 30 real minutes after its first start.
    const starts = between(
      schedule,
      at('2026-04-04T14:20Z'),
      at('2026-04-04T15:30Z'),
    );
    expect(starts.map(iso)).toEqual([
      '2026-04-04T14:20Z',
      '2026-04-04T14:40Z',
      '2026-04-04T15:10Z',
      '2026-04-04T15:30Z',
    ]);
    expect(starts.map((ms) => local(ms, 'Australia/Lord_Howe'))).toEqual([
      '01:20',
      '01:40',
      '01:40',
      '02:00',
    ]);
  });

  it('aligns Kolkata to local midnight, not to the UTC hour', () => {
    const schedule = rule(
      { frequency: 'minutely', interval: 20 },
      'Asia/Kolkata',
    );
    expect(
      occurrencesAfter(schedule, at('2026-01-01T00:00Z'), 2).map(iso),
    ).toEqual(['2026-01-01T00:10Z', '2026-01-01T00:30Z']);
  });

  it('runs a grid cron the same way, minute or hour starred', () => {
    expect(
      between(
        cron('*/15 * * * *', 'Europe/Zurich'),
        at('2026-10-25T00:00Z'),
        at('2026-10-25T02:00Z'),
      ),
    ).toHaveLength(9);
    expect(
      between(
        cron('30 * * * *', 'Europe/Zurich'),
        at('2026-10-24T23:00Z'),
        at('2026-10-25T03:00Z'),
      ).map(iso),
    ).toEqual([
      '2026-10-24T23:30Z',
      '2026-10-25T00:30Z',
      '2026-10-25T01:30Z',
      '2026-10-25T02:30Z',
    ]);
  });

  it('walks back over a repeated hour the same way it walks forward', () => {
    const schedule = rule(quarterHour, 'Europe/Zurich');
    const forward = between(
      schedule,
      at('2026-10-25T00:00Z'),
      at('2026-10-25T02:00Z'),
    );
    const backward: number[] = [];
    let cursor = at('2026-10-25T02:00Z');
    while (backward.length < forward.length) {
      const previous = previousOccurrence(schedule, cursor);
      if (previous === null) break;
      backward.push(previous);
      cursor = previous - 1;
    }
    expect(backward.toReversed()).toEqual(forward);
  });
});

/** Every whole minute in [from, to] whose wall clock is on the rule's grid
 * and inside its window — the grid class's definition, read minute by
 * minute with no jumps. */
function gridByDefinition(
  value: Extract<ScheduleRule, { frequency: 'minutely' | 'hourly' }>,
  zone: string,
  from: number,
  to: number,
): number[] {
  const step =
    value.frequency === 'hourly'
      ? {
          frequency: value.frequency,
          interval: value.interval,
          minute: value.minute,
        }
      : { frequency: value.frequency, interval: value.interval };
  const starts: number[] = [];
  for (let ms = from; ms <= to; ms += MINUTE) {
    const clock = wallClockIn(ms, zone);
    const minute = clock.hour * 60 + clock.minute;
    if (gridMinuteAtOrAfter(step, minute) !== minute) continue;
    const window = value.window;
    if (window !== undefined) {
      const yesterday = new Date(
        Date.UTC(clock.year, clock.month - 1, clock.day - 1),
      ).getUTCDay();
      const ranges = windowRangesOn(
        window.hours,
        window.weekdays.includes(clock.weekday),
        window.weekdays.includes(yesterday),
      );
      if (!ranges.some(([lo, hi]) => minute >= lo && minute < hi)) continue;
    }
    starts.push(ms);
  }
  return starts;
}

describe('grid walks against the grid by definition', () => {
  const zones: [string, string[]][] = [
    ['Europe/Zurich', ['2026-03-29T01:00Z', '2026-10-25T01:00Z']],
    ['America/New_York', ['2026-03-08T07:00Z', '2026-11-01T06:00Z']],
    ['Australia/Lord_Howe', ['2026-04-04T15:00Z', '2026-10-03T15:30Z']],
    ['Asia/Kolkata', ['2026-03-29T01:00Z']],
  ];
  const rules: Extract<ScheduleRule, { frequency: 'minutely' | 'hourly' }>[] = [
    { frequency: 'minutely', interval: 4 },
    { frequency: 'minutely', interval: 20 },
    { frequency: 'minutely', interval: 30 },
    { frequency: 'hourly', interval: 1, minute: 30 },
    { frequency: 'hourly', interval: 2, minute: 0 },
    { frequency: 'hourly', interval: 3, minute: 15 },
    { frequency: 'hourly', interval: 8, minute: 45 },
    {
      frequency: 'minutely',
      interval: 12,
      window: { weekdays: [0, 6], hours: { from: '23:00', to: '04:00' } },
    },
    {
      frequency: 'hourly',
      interval: 2,
      minute: 0,
      window: { weekdays: [0, 1, 6], hours: { from: '01:00', to: '05:00' } },
    },
  ];

  it('finds every start, a repeated hour twice, forward and back', () => {
    const mismatches: string[] = [];
    for (const [zone, changes] of zones) {
      for (const change of changes) {
        const from = at(change) - 8 * HOUR;
        const to = at(change) + 8 * HOUR;
        for (const value of rules) {
          const schedule = rule(value, zone);
          const expected = gridByDefinition(value, zone, from, to);
          const forward = between(schedule, from, to);
          const backward: number[] = [];
          let cursor = to;
          for (;;) {
            const previous = previousOccurrence(schedule, cursor, from);
            if (previous === null) break;
            backward.push(previous);
            cursor = previous - 1;
          }
          for (const [walk, found] of [
            ['forward', forward],
            ['back', backward.toReversed()],
          ] as const) {
            if (found.join() !== expected.join()) {
              mismatches.push(
                `${JSON.stringify(value)} in ${zone} around ${change}, ${walk}: ${found.map(iso).join(' ')} | expected ${expected.map(iso).join(' ')}`,
              );
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('starts the repeated 02:00 of an every-2-hours grid in Zurich', () => {
    const schedule = rule(
      { frequency: 'hourly', interval: 2, minute: 0 },
      'Europe/Zurich',
    );
    expect(
      between(schedule, at('2026-10-24T22:00Z'), at('2026-10-25T05:00Z')).map(
        iso,
      ),
    ).toEqual([
      '2026-10-24T22:00Z',
      '2026-10-25T00:00Z',
      '2026-10-25T01:00Z',
      '2026-10-25T03:00Z',
      '2026-10-25T05:00Z',
    ]);
  });
});

describe('day rules: phase, clamps and times', () => {
  it('phases every 2 months on the 5th from its first day after the start', () => {
    const schedule = rule(
      { frequency: 'monthly', interval: 2, monthDay: 5, times: ['09:00'] },
      'UTC',
      '2026-10-08',
    );
    expect(
      occurrencesAfter(schedule, at('2026-10-01T00:00Z'), 3).map(iso),
    ).toEqual(['2026-11-05T09:00Z', '2027-01-05T09:00Z', '2027-03-05T09:00Z']);
  });

  it('takes the rest of the first week, then every second week', () => {
    // Saved on Wednesday 2026-10-07.
    const schedule = rule(
      { frequency: 'weekly', interval: 2, weekdays: [4, 2], times: ['08:00'] },
      'UTC',
      '2026-10-07',
    );
    expect(
      occurrencesAfter(schedule, at('2026-10-01T00:00Z'), 4).map(iso),
    ).toEqual([
      '2026-10-08T08:00Z',
      '2026-10-20T08:00Z',
      '2026-10-22T08:00Z',
      '2026-11-03T08:00Z',
    ]);
  });

  it('steps every 3 days from the start date', () => {
    const schedule = rule(daily(['06:00'], 3), 'UTC', '2026-10-08');
    expect(
      occurrencesAfter(schedule, at('2026-10-09T00:00Z'), 2).map(iso),
    ).toEqual(['2026-10-11T06:00Z', '2026-10-14T06:00Z']);
  });

  it('clamps the 31st to each short month and keeps it', () => {
    const schedule = rule(
      { frequency: 'monthly', interval: 1, monthDay: 31, times: ['09:00'] },
      'UTC',
      '2026-10-01',
    );
    expect(
      occurrencesAfter(schedule, at('2026-10-01T00:00Z'), 6).map((ms) =>
        iso(ms).slice(0, 10),
      ),
    ).toEqual([
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
  });

  it('lands February 29 on the 28th in a common year', () => {
    const schedule = rule(
      {
        frequency: 'yearly',
        interval: 1,
        month: 2,
        monthDay: 29,
        times: ['09:00'],
      },
      'UTC',
      '2026-03-01',
    );
    expect(
      occurrencesAfter(schedule, at('2026-03-01T00:00Z'), 3).map((ms) =>
        iso(ms).slice(0, 10),
      ),
    ).toEqual(['2027-02-28', '2028-02-29', '2029-02-28']);
  });

  it('starts several times a day in order', () => {
    const schedule = rule(daily(['17:30', '09:00', '12:00']), 'Europe/Zurich');
    expect(
      occurrencesAfter(schedule, at('2026-10-08T06:00Z'), 4).map((ms) =>
        local(ms, 'Europe/Zurich'),
      ),
    ).toEqual(['09:00', '12:00', '17:30', '09:00']);
  });

  it('never starts before its start date, a grid included', () => {
    expect(
      occurrencesAfter(
        rule(daily(['09:00']), 'UTC', '2026-10-10'),
        at('2026-10-01T00:00Z'),
        1,
      ).map(iso),
    ).toEqual(['2026-10-10T09:00Z']);
    expect(
      occurrencesAfter(
        rule(
          { frequency: 'minutely', interval: 15 },
          'Europe/Zurich',
          '2026-10-10',
        ),
        at('2026-10-01T00:00Z'),
        1,
      ).map(iso),
    ).toEqual(['2026-10-09T22:00Z']);
    expect(
      previousOccurrence(
        rule(daily(['09:00']), 'UTC', '2026-10-10'),
        at('2026-10-10T08:00Z'),
      ),
    ).toBeNull();
  });

  it('finds the previous start of a sparse rule without walking day by day', () => {
    const schedule = rule(
      {
        frequency: 'yearly',
        interval: 3,
        month: 6,
        monthDay: 15,
        times: ['09:00'],
      },
      'UTC',
      '2026-01-01',
    );
    expect(
      iso(previousOccurrence(schedule, at('2033-01-01T00:00Z')) ?? 0),
    ).toBe('2032-06-15T09:00Z');
    expect(
      previousOccurrence(
        schedule,
        at('2033-01-01T00:00Z'),
        at('2032-07-01T00:00Z'),
      ),
    ).toBeNull();
  });
});

describe('windows', () => {
  it('runs an overnight window into the next morning, owned by its start day', () => {
    // Every 30 minutes, Fridays 22:00 until 06:00.
    const schedule = rule({
      frequency: 'minutely',
      interval: 30,
      window: { weekdays: [5], hours: { from: '22:00', to: '06:00' } },
    });
    const starts = between(
      schedule,
      at('2026-10-09T00:00Z'),
      at('2026-10-17T00:00Z'),
    );
    expect(iso(starts[0] ?? 0)).toBe('2026-10-09T22:00Z');
    expect(iso(starts[15] ?? 0)).toBe('2026-10-10T05:30Z');
    expect(iso(starts[16] ?? 0)).toBe('2026-10-16T22:00Z');
    expect(starts.some((ms) => iso(ms) === '2026-10-10T22:00Z')).toBe(false);
  });

  it('runs an overnight window through a Zurich fall-back at elapsed pace', () => {
    // Saturday night into Sunday 2026-10-25, every 30 minutes.
    const schedule = rule(
      {
        frequency: 'minutely',
        interval: 30,
        window: { weekdays: [6], hours: { from: '22:00', to: '06:00' } },
      },
      'Europe/Zurich',
    );
    const starts = between(
      schedule,
      at('2026-10-24T12:00Z'),
      at('2026-10-25T12:00Z'),
    );
    const times = starts.map((ms) => local(ms, 'Europe/Zurich'));
    expect(times.filter((time) => time === '02:00')).toHaveLength(2);
    expect(times.filter((time) => time === '02:30')).toHaveLength(2);
    expect(times[0]).toBe('22:00');
    expect(times.at(-1)).toBe('05:30');
    expect(starts).toHaveLength(18);
  });

  it('opens at its start and closes before its end', () => {
    const schedule = rule({
      frequency: 'minutely',
      interval: 15,
      window: { weekdays: [1], hours: { from: '09:00', to: '10:00' } },
    });
    expect(
      occurrencesAfter(schedule, at('2026-10-05T00:00Z'), 5).map(iso),
    ).toEqual([
      '2026-10-05T09:00Z',
      '2026-10-05T09:15Z',
      '2026-10-05T09:30Z',
      '2026-10-05T09:45Z',
      '2026-10-12T09:00Z',
    ]);
  });

  it('runs until midnight when it ends at 00:00', () => {
    const schedule = rule({
      frequency: 'minutely',
      interval: 30,
      window: { weekdays: [1], hours: { from: '23:00', to: '00:00' } },
    });
    expect(
      occurrencesAfter(schedule, at('2026-10-05T00:00Z'), 3).map(iso),
    ).toEqual(['2026-10-05T23:00Z', '2026-10-05T23:30Z', '2026-10-12T23:00Z']);
  });

  it('runs hourly on even hours in office hours on weekdays', () => {
    const schedule = rule({
      frequency: 'hourly',
      interval: 2,
      minute: 15,
      window: {
        weekdays: [1, 2, 3, 4, 5],
        hours: { from: '08:00', to: '18:00' },
      },
    });
    // Friday 2026-10-09: 08:15 … 16:15, then Monday.
    expect(
      occurrencesAfter(schedule, at('2026-10-09T00:00Z'), 6).map(iso),
    ).toEqual([
      '2026-10-09T08:15Z',
      '2026-10-09T10:15Z',
      '2026-10-09T12:15Z',
      '2026-10-09T14:15Z',
      '2026-10-09T16:15Z',
      '2026-10-12T08:15Z',
    ]);
  });

  it('runs all day on its weekdays when it names no hours', () => {
    const schedule = rule({
      frequency: 'minutely',
      interval: 30,
      window: { weekdays: [1] },
    });
    const starts = between(
      schedule,
      at('2026-10-04T00:00Z'),
      at('2026-10-06T23:59Z'),
    );
    expect(starts).toHaveLength(48);
    expect(iso(starts[0] ?? 0)).toBe('2026-10-05T00:00Z');
  });

  it('answers none, without spinning, for a window no start falls in', () => {
    const schedule = rule({
      frequency: 'minutely',
      interval: 30,
      window: { weekdays: [1], hours: { from: '23:45', to: '00:00' } },
    });
    expect(nextOccurrence(schedule, at('2026-10-05T00:00Z'))).toBeNull();
  });
});

describe('cron schedules', () => {
  it('keeps crontab day rules and waits years for February 29', () => {
    expect(
      occurrencesAfter(cron('0 9 1 * 1'), at('2026-10-01T10:00Z'), 3).map(iso),
    ).toEqual(['2026-10-05T09:00Z', '2026-10-12T09:00Z', '2026-10-19T09:00Z']);
    expect(
      occurrencesAfter(cron('0 0 29 2 *'), at('2096-03-01T00:00Z'), 1).map(iso),
    ).toEqual(['2104-02-29T00:00Z']);
    expect(
      iso(previousOccurrence(cron('0 0 29 2 *'), at('2104-01-01T00:00Z')) ?? 0),
    ).toBe('2096-02-29T00:00Z');
  });

  it('agrees with the scan matcher it replaces on ordinary days', () => {
    for (const [expression, zone] of [
      ['*/7 3-5 * * *', 'Europe/Zurich'],
      ['15 9,17 * * 1-5', 'America/New_York'],
      ['0 */6 1,15 * *', 'Asia/Kolkata'],
      ['45 23 * 1,7 0', 'Australia/Lord_Howe'],
    ] as const) {
      let cursor = at('2026-06-01T00:00Z');
      for (let i = 0; i < 6; i += 1) {
        const mine = nextOccurrence(cron(expression, zone), cursor);
        const theirs = firstOccurrenceBetween(
          parseCron(expression),
          zone,
          cursor,
          cursor + 400 * DAY,
        );
        expect(mine, `${expression} in ${zone} after ${iso(cursor)}`).toBe(
          theirs,
        );
        cursor = mine ?? cursor + DAY;
      }
    }
  });
});

describe('countBetween', () => {
  it('counts both ends and stops at its cap', () => {
    const schedule = rule({ frequency: 'minutely', interval: 1 });
    expect(
      countBetween(
        schedule,
        at('2026-10-08T09:00Z'),
        at('2026-10-08T09:10Z'),
        100,
      ),
    ).toEqual({
      count: 11,
      capped: false,
    });
    expect(
      countBetween(
        schedule,
        at('2026-10-08T09:00Z'),
        at('2026-10-08T09:10Z'),
        11,
      ),
    ).toEqual({
      count: 11,
      capped: false,
    });
    expect(
      countBetween(
        schedule,
        at('2026-10-08T09:00Z'),
        at('2026-10-08T09:10Z'),
        10,
      ),
    ).toEqual({
      count: 10,
      capped: true,
    });
  });
});

describe('decideDue', () => {
  const nine = rule(daily(['09:00']));
  const d1 = at('2026-10-05T09:00Z');
  const d3 = at('2026-10-07T09:00Z');

  it('starts the one occurrence that came due', () => {
    expect(decideDue(nine, d1, 0, d1 + 30_000, 'latest')).toEqual({
      fire: d1,
      handledThrough: d1,
      missed: null,
      next: d1 + DAY,
    });
  });

  it('starts the latest of three and counts the two before it', () => {
    expect(decideDue(nine, d1, 0, d3 + HOUR, 'latest')).toEqual({
      fire: d3,
      handledThrough: d3,
      missed: { count: 2, capped: false, firstAt: d1, lastAt: d1 + DAY },
      next: d3 + DAY,
    });
  });

  it('with skip, starts it only within ten minutes', () => {
    expect(SCHEDULE_ON_TIME_GRACE_MS).toBe(10 * MINUTE);
    expect(decideDue(nine, d3, 0, d3 + 10 * MINUTE, 'skip').fire).toBe(d3);
    const late = decideDue(nine, d1, 0, d3 + 10 * MINUTE + 1000, 'skip');
    expect(late.fire).toBeNull();
    expect(late.handledThrough).toBe(d3);
    expect(late.missed).toEqual({
      count: 3,
      capped: false,
      firstAt: d1,
      lastAt: d3,
    });
  });

  it('starts a monthly 09:00 late after an outage from 08:30 to 10:30', () => {
    const monthly = rule({
      frequency: 'monthly',
      interval: 1,
      monthDay: 8,
      times: ['09:00'],
    });
    const due = at('2026-10-08T09:00Z');
    const decision = decideDue(
      monthly,
      due,
      0,
      at('2026-10-08T10:30Z'),
      'latest',
    );
    expect(decision.fire).toBe(due);
    expect(decision.missed).toBeNull();
    expect(iso(decision.next ?? 0)).toBe('2026-11-08T09:00Z');
  });

  it('caps the missed count at 1000', () => {
    const everyMinute = rule({ frequency: 'minutely', interval: 1 });
    const from = at('2026-10-08T00:00Z');
    const many = decideDue(
      everyMinute,
      from,
      0,
      from + 4999 * MINUTE,
      'latest',
    );
    expect(many.fire).toBe(from + 4999 * MINUTE);
    expect(many.missed).toMatchObject({
      count: MISSED_COUNT_CAP,
      capped: true,
      firstAt: from,
    });
    const justEnough = decideDue(
      everyMinute,
      from,
      0,
      from + 1000 * MINUTE,
      'latest',
    );
    expect(justEnough.missed).toMatchObject({ count: 1000, capped: false });
    const skipped = decideDue(
      everyMinute,
      from,
      0,
      from + 4999 * MINUTE + 11 * MINUTE + 30_000,
      'skip',
    );
    expect(skipped.fire).toBe(from + 5010 * MINUTE);
  });

  it('never starts what an earlier scan already claimed', () => {
    expect(decideDue(nine, d1, d3, d3 + HOUR, 'latest')).toEqual({
      fire: null,
      handledThrough: d3,
      missed: null,
      next: d3 + DAY,
    });
  });

  it('does nothing before its pending occurrence', () => {
    expect(decideDue(nine, d3, 0, d3 - MINUTE, 'latest')).toEqual({
      fire: null,
      handledThrough: 0,
      missed: null,
      next: d3,
    });
  });
});

describe('scheduleOfTrigger', () => {
  it('reads a cron, in UTC when it names no zone', () => {
    for (const timezone of [null, '', '  ']) {
      const found = scheduleOfTrigger({
        cron: ' 0 9 * * * ',
        timezone,
        scheduleRule: null,
      });
      expect(found).toMatchObject({
        schedule: { type: 'cron', timezone: 'UTC', dstClass: 'named' },
      });
    }
  });

  it('lets a cron win over a stored rule', () => {
    const found = scheduleOfTrigger({
      cron: '*/5 * * * *',
      timezone: 'europe/zurich',
      scheduleRule: { repeat: daily(['09:00']), startDate: '2026-10-08' },
    });
    expect(found).toMatchObject({
      schedule: { type: 'cron', timezone: 'Europe/Zurich', dstClass: 'grid' },
    });
  });

  it('reads a stored rule, normalised, in its zone', () => {
    expect(
      scheduleOfTrigger({
        cron: null,
        timezone: 'Europe/Zurich',
        scheduleRule: {
          repeat: daily(['17:30', '09:00', '09:00']),
          startDate: '2026-10-08',
        },
      }),
    ).toEqual({
      schedule: {
        type: 'rule',
        rule: { frequency: 'daily', interval: 1, times: ['09:00', '17:30'] },
        timezone: 'Europe/Zurich',
        startDate: day('2026-10-08'),
      },
    });
  });

  it.each([
    [
      'an unknown zone',
      { cron: '0 9 * * *', timezone: 'Mars/Base', scheduleRule: null },
      'unknown time zone',
    ],
    [
      'an unreadable cron',
      { cron: '0 9 * *', timezone: 'UTC', scheduleRule: null },
      '5 fields',
    ],
    [
      'nothing at all',
      { cron: null, timezone: 'UTC', scheduleRule: null },
      'neither',
    ],
    [
      'a rule with no zone',
      {
        cron: null,
        timezone: null,
        scheduleRule: { repeat: daily(['09:00']), startDate: '2026-10-08' },
      },
      'needs a time zone',
    ],
    [
      'a rule that does not parse',
      {
        cron: null,
        timezone: 'UTC',
        scheduleRule: { repeat: daily(['9:00']), startDate: '2026-10-08' },
      },
      'unreadable',
    ],
    [
      'a start date that is no day',
      {
        cron: null,
        timezone: 'UTC',
        scheduleRule: { repeat: daily(['09:00']), startDate: '2026-02-30' },
      },
      'no day',
    ],
  ] as const)('names why %s describes no schedule', (_name, source, why) => {
    const found = scheduleOfTrigger(source);
    expect('issue' in found ? found.issue : '').toContain(why);
  });
});

// ---------------------------------------------------------------------------
// Same words, same days: the task series
// ---------------------------------------------------------------------------

/** mulberry32: a small seeded generator, so a failure replays. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The zone-free half of a day rule: what a task stores and a schedule's
 * day rule carries, before its zone or its times. */
type DayWords =
  | { frequency: 'daily'; interval: number }
  | { frequency: 'weekly'; interval: number; weekdays: number[] }
  | { frequency: 'monthly'; interval: number; monthDay: number }
  | { frequency: 'yearly'; interval: number; month: number; monthDay: number };

const MAX_MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function randomWords(random: () => number): DayWords {
  const pick = <T>(values: readonly T[], fallback: T): T =>
    values[Math.floor(random() * values.length)] ?? fallback;
  const interval = pick([1, 1, 1, 2, 3, 4, 6, 12, 52, 99], 1);
  const monthDay =
    random() < 0.3
      ? 28 + Math.floor(random() * 4)
      : 1 + Math.floor(random() * 31);
  const frequency = pick(
    ['daily', 'weekly', 'monthly', 'yearly'] as const,
    'daily',
  );
  switch (frequency) {
    case 'daily':
      return { frequency: 'daily', interval };
    case 'weekly': {
      const weekdays = [0, 1, 2, 3, 4, 5, 6].filter(() => random() < 0.35);
      return {
        frequency: 'weekly',
        interval,
        weekdays: weekdays.length > 0 ? weekdays : [1],
      };
    }
    case 'monthly':
      return { frequency: 'monthly', interval, monthDay };
    case 'yearly': {
      const month = 1 + Math.floor(random() * 12);
      return {
        frequency: 'yearly',
        interval,
        month,
        monthDay: Math.min(monthDay, MAX_MONTH_DAYS[month - 1] ?? 28),
      };
    }
    default: {
      const exhaustive: never = frequency;
      return exhaustive;
    }
  }
}

describe('day rules name the days a task with the same words does', () => {
  it('agrees with the task series for 500 seeded rules and start dates', () => {
    const random = seeded(4_2026_10_08);
    const zones = [
      'UTC',
      'Europe/Zurich',
      'America/New_York',
      'Australia/Lord_Howe',
    ];
    const mismatches: string[] = [];
    for (let i = 0; i < 500; i += 1) {
      const zone = zones[Math.floor(random() * zones.length)] ?? 'UTC';
      const words = randomWords(random);
      const start: CalendarDate = {
        year: 2024 + Math.floor(random() * 6),
        month: 1 + Math.floor(random() * 12),
        day: 1 + Math.floor(random() * 28),
      };
      const task: TaskRepeat = { ...words, timezone: zone };
      const today = startOfCalendarDate(start, zone);
      const taskDays: string[] = [];
      let due = firstTaskRepeatOccurrence(task, today);
      for (let n = 0; n < 6; n += 1) {
        const date = calendarDateIn(due, zone);
        taskDays.push(`${date.year}-${date.month}-${date.day}`);
        due = nextTaskRepeatOccurrence(task, due, today);
      }
      const scheduleRule: ScheduleRule = { ...words, times: ['00:00'] };
      const schedule: Schedule = {
        type: 'rule',
        rule: scheduleRule,
        timezone: zone,
        startDate: start,
      };
      const scheduleDays = occurrencesAfter(schedule, today - DAY, 6).map(
        (ms) => {
          const date = localDateIn(ms, zone);
          return `${date.year}-${date.month}-${date.day}`;
        },
      );
      if (scheduleDays.join() !== taskDays.join()) {
        mismatches.push(
          `${JSON.stringify(words)} from ${start.year}-${start.month}-${start.day} in ${zone}: task ${taskDays.join(' ')}, schedule ${scheduleDays.join(' ')}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });
});
