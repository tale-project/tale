// @vitest-environment node

/**
 * Cron expressions and repeat rules convert only where nothing is lost,
 * daylight-saving behaviour included. Every lossless row converts both
 * ways; every other shape stays what it is. A seeded property test turns
 * 1,000 rules into their cron and holds the two to the same starts around
 * each 2026 clock change of four zones, and the converted cron to the scan
 * matcher it replaces on ordinary days.
 */

import {
  type ScheduleRule,
  sameScheduleRule,
  SCHEDULE_HOUR_INTERVALS,
  SCHEDULE_MINUTE_INTERVALS,
} from '@tale/shared/schemas/schedule-rule';
import { describe, expect, it } from 'vitest';

import { firstOccurrenceBetween } from '../../../backend/core/automations/cron.ts';
import type { CalendarDate } from '../../shared/calendar.ts';
import { cronDstClass, parseCron } from '../cron.ts';
import {
  cronRuleStartDate,
  cronToScheduleRule,
  scheduleRuleToCron,
} from './cron-rule.ts';
import {
  occurrencesAfter,
  previousOccurrence,
  type Schedule,
} from './occurrences.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const JANUARY: CalendarDate = { year: 2026, month: 1, day: 1 };

describe('cronToScheduleRule', () => {
  it.each<[string, ScheduleRule]>([
    ['* * * * *', { frequency: 'minutely', interval: 1 }],
    ['*/15 * * * *', { frequency: 'minutely', interval: 15 }],
    ['0,30 * * * *', { frequency: 'minutely', interval: 30 }],
    [
      '*/10 9-17 * * 1-5',
      {
        frequency: 'minutely',
        interval: 10,
        window: {
          weekdays: [1, 2, 3, 4, 5],
          hours: { from: '09:00', to: '18:00' },
        },
      },
    ],
    [
      '*/30 22-23 * * *',
      {
        frequency: 'minutely',
        interval: 30,
        window: {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          hours: { from: '22:00', to: '00:00' },
        },
      },
    ],
    [
      '*/5 8 * * 6,0',
      {
        frequency: 'minutely',
        interval: 5,
        window: { weekdays: [0, 6], hours: { from: '08:00', to: '09:00' } },
      },
    ],
    [
      '*/15 * * * 1-5',
      {
        frequency: 'minutely',
        interval: 15,
        window: { weekdays: [1, 2, 3, 4, 5] },
      },
    ],
    ['30 * * * *', { frequency: 'hourly', interval: 1, minute: 30 }],
    ['0 */6 * * *', { frequency: 'hourly', interval: 6, minute: 0 }],
    ['0 9 * * *', { frequency: 'daily', interval: 1, times: ['09:00'] }],
    [
      '0,30 9,17 * * *',
      {
        frequency: 'daily',
        interval: 1,
        times: ['09:00', '09:30', '17:00', '17:30'],
      },
    ],
    ['0 9 * * 0-6', { frequency: 'daily', interval: 1, times: ['09:00'] }],
    [
      '0 9 * * 1-5',
      {
        frequency: 'weekly',
        interval: 1,
        weekdays: [1, 2, 3, 4, 5],
        times: ['09:00'],
      },
    ],
    [
      '0 9 * * 7',
      { frequency: 'weekly', interval: 1, weekdays: [0], times: ['09:00'] },
    ],
    [
      '0 8-18 * * 1-5',
      {
        frequency: 'weekly',
        interval: 1,
        weekdays: [1, 2, 3, 4, 5],
        times: [
          '08:00',
          '09:00',
          '10:00',
          '11:00',
          '12:00',
          '13:00',
          '14:00',
          '15:00',
          '16:00',
          '17:00',
          '18:00',
        ],
      },
    ],
    [
      '15 9-17/4 * * 2',
      {
        frequency: 'weekly',
        interval: 1,
        weekdays: [2],
        times: ['09:15', '13:15', '17:15'],
      },
    ],
    [
      '0 9 5 * *',
      { frequency: 'monthly', interval: 1, monthDay: 5, times: ['09:00'] },
    ],
    [
      '0 9 28 * *',
      { frequency: 'monthly', interval: 1, monthDay: 28, times: ['09:00'] },
    ],
    [
      '0 9 5 */3 *',
      { frequency: 'monthly', interval: 3, monthDay: 5, times: ['09:00'] },
    ],
    [
      '0 9 5 1-12/2 *',
      { frequency: 'monthly', interval: 2, monthDay: 5, times: ['09:00'] },
    ],
    [
      '0 9 5 1,7 *',
      { frequency: 'monthly', interval: 6, monthDay: 5, times: ['09:00'] },
    ],
    [
      '0 9 5 1 *',
      {
        frequency: 'yearly',
        interval: 1,
        month: 1,
        monthDay: 5,
        times: ['09:00'],
      },
    ],
    [
      '0 0 31 12 *',
      {
        frequency: 'yearly',
        interval: 1,
        month: 12,
        monthDay: 31,
        times: ['00:00'],
      },
    ],
  ])('reads %s as a rule', (expression, expected) => {
    expect(cronToScheduleRule(expression)).toEqual(expected);
  });

  it.each([
    ['0 9 */2 * *', 'every other day of the month restarts each month'],
    ['0 9 31 * *', 'the 31st every month skips short months'],
    ['0 9 29 * *', 'the 29th every month skips February'],
    ['0 9 29 2 *', 'February 29 waits for a leap year'],
    ['0 9 1 * 1', 'a day of the month and a weekday are read as either'],
    ['0 9 * 3 *', 'every day of one month'],
    ['0 9 5 2,8 *', 'months that are no step from January'],
    ['0 9 5 */5 *', 'a month step that does not divide the year'],
    ['*/15 */2 * * *', 'a minute grid in a stepped hour list'],
    ['*/15 9,17 * * *', 'a minute grid in hours that are no range'],
    ['*/7 * * * *', 'a minute step that does not divide the hour'],
    ['5-59/15 * * * *', 'a grid off the hour'],
    ['0 */5 * * *', 'an hour step that does not divide the day'],
    ['30 * * * 1-5', 'an hourly grid limited to weekdays'],
    ['0,10,20,30,40,50 8-10 * * *', 'more than twelve times a day'],
    ['*/15 9-17 1 * *', 'a grid on one day of the month'],
    ['0 9 * *', 'an expression that does not parse'],
  ])('keeps %s as cron: %s', (expression) => {
    expect(cronToScheduleRule(expression)).toBeNull();
  });

  it('phases a converted monthly step from January', () => {
    expect(cronRuleStartDate({ year: 2026, month: 10, day: 8 })).toEqual(
      JANUARY,
    );
  });
});

describe('scheduleRuleToCron', () => {
  it.each<[ScheduleRule, string]>([
    [{ frequency: 'minutely', interval: 1 }, '* * * * *'],
    [{ frequency: 'minutely', interval: 20 }, '*/20 * * * *'],
    [
      {
        frequency: 'minutely',
        interval: 10,
        window: { weekdays: [1, 2, 3, 4, 5] },
      },
      '*/10 * * * 1-5',
    ],
    [
      {
        frequency: 'minutely',
        interval: 15,
        window: { weekdays: [1, 3, 5], hours: { from: '08:00', to: '18:00' } },
      },
      '*/15 8-17 * * 1,3,5',
    ],
    [
      {
        frequency: 'minutely',
        interval: 30,
        window: { weekdays: [6], hours: { from: '22:00', to: '00:00' } },
      },
      '*/30 22-23 * * 6',
    ],
    [
      {
        frequency: 'minutely',
        interval: 5,
        window: { weekdays: [2], hours: { from: '07:00', to: '08:00' } },
      },
      '*/5 7 * * 2',
    ],
    [{ frequency: 'hourly', interval: 1, minute: 45 }, '45 * * * *'],
    [{ frequency: 'hourly', interval: 8, minute: 0 }, '0 */8 * * *'],
    [
      {
        frequency: 'daily',
        interval: 1,
        times: ['09:00', '09:30', '17:00', '17:30'],
      },
      '0,30 9,17 * * *',
    ],
    [
      { frequency: 'weekly', interval: 1, weekdays: [0, 6], times: ['10:00'] },
      '0 10 * * 0,6',
    ],
    [
      {
        frequency: 'weekly',
        interval: 1,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        times: ['10:00'],
      },
      '0 10 * * *',
    ],
    [
      { frequency: 'monthly', interval: 1, monthDay: 15, times: ['06:00'] },
      '0 6 15 * *',
    ],
    [
      {
        frequency: 'yearly',
        interval: 1,
        month: 4,
        monthDay: 30,
        times: ['12:00'],
      },
      '0 12 30 4 *',
    ],
  ])(
    'writes %j as %s, which reads back as the same rule',
    (rule, expression) => {
      expect(scheduleRuleToCron(rule)).toBe(expression);
      expect(sameScheduleRule(cronToScheduleRule(expression), rule)).toBe(
        !(rule.frequency === 'weekly' && rule.weekdays.length === 7),
      );
    },
  );

  it('writes a monthly step only for a rule phased from January', () => {
    const quarterly: ScheduleRule = {
      frequency: 'monthly',
      interval: 3,
      monthDay: 5,
      times: ['09:00'],
    };
    expect(scheduleRuleToCron(quarterly, JANUARY)).toBe('0 9 5 */3 *');
    expect(
      scheduleRuleToCron(quarterly, { year: 2026, month: 4, day: 2 }),
    ).toBe('0 9 5 */3 *');
    expect(
      scheduleRuleToCron(quarterly, { year: 2026, month: 10, day: 8 }),
    ).toBeNull();
    expect(scheduleRuleToCron(quarterly)).toBeNull();
  });

  it.each<[string, ScheduleRule]>([
    [
      'an overnight window',
      {
        frequency: 'minutely',
        interval: 30,
        window: { weekdays: [5], hours: { from: '22:00', to: '06:00' } },
      },
    ],
    [
      'a window off the hour',
      {
        frequency: 'minutely',
        interval: 15,
        window: { weekdays: [1], hours: { from: '08:30', to: '18:00' } },
      },
    ],
    [
      'an hourly rule with a window',
      {
        frequency: 'hourly',
        interval: 1,
        minute: 0,
        window: { weekdays: [1, 2, 3, 4, 5] },
      },
    ],
    [
      'times that are no pairing of minutes and hours',
      { frequency: 'daily', interval: 1, times: ['09:00', '17:30'] },
    ],
    ['every other day', { frequency: 'daily', interval: 2, times: ['09:00'] }],
    [
      'every other week',
      { frequency: 'weekly', interval: 2, weekdays: [1], times: ['09:00'] },
    ],
    [
      'the 31st every month',
      { frequency: 'monthly', interval: 1, monthDay: 31, times: ['09:00'] },
    ],
    [
      'every fifth month',
      { frequency: 'monthly', interval: 5, monthDay: 1, times: ['09:00'] },
    ],
    [
      'February 29',
      {
        frequency: 'yearly',
        interval: 1,
        month: 2,
        monthDay: 29,
        times: ['09:00'],
      },
    ],
    [
      'every other year',
      {
        frequency: 'yearly',
        interval: 2,
        month: 6,
        monthDay: 1,
        times: ['09:00'],
      },
    ],
  ])('has no cron for %s', (_name, rule) => {
    expect(scheduleRuleToCron(rule, JANUARY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The property test
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

const SURE_MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** A rule from one of the lossless rows, at random. */
function losslessRule(random: () => number): ScheduleRule {
  const int = (below: number) => Math.floor(random() * below);
  const pick = <T>(values: readonly T[], fallback: T): T =>
    values[int(values.length)] ?? fallback;
  const subset = (values: readonly number[], keep: number) => {
    const chosen = values.filter(() => random() < keep);
    return chosen.length > 0 ? chosen : [pick(values, 0)];
  };
  const times = () => {
    const hours = subset(
      Array.from({ length: 24 }, (_, i) => i),
      0.12,
    ).slice(0, 4);
    const minutes = subset([0, 5, 15, 30, 45, 59], 0.3).slice(
      0,
      Math.floor(12 / hours.length),
    );
    return hours.flatMap((hour) =>
      minutes.map(
        (minute) =>
          `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      ),
    );
  };
  const weekdays = () => subset([0, 1, 2, 3, 4, 5, 6], 0.5);
  switch (int(8)) {
    case 0:
      return {
        frequency: 'minutely',
        interval: pick(SCHEDULE_MINUTE_INTERVALS, 15),
      };
    case 1:
      return {
        frequency: 'minutely',
        interval: pick(SCHEDULE_MINUTE_INTERVALS, 15),
        window: { weekdays: weekdays() },
      };
    case 2: {
      const from = int(23);
      const to = from + 1 + int(24 - from);
      return {
        frequency: 'minutely',
        interval: pick(SCHEDULE_MINUTE_INTERVALS, 15),
        window: {
          weekdays: weekdays(),
          hours: {
            from: `${String(from).padStart(2, '0')}:00`,
            to: `${String(to % 24).padStart(2, '0')}:00`,
          },
        },
      };
    }
    case 3:
      return {
        frequency: 'hourly',
        interval: pick(SCHEDULE_HOUR_INTERVALS, 1),
        minute: int(60),
      };
    case 4:
      return { frequency: 'daily', interval: 1, times: times() };
    case 5:
      return {
        frequency: 'weekly',
        interval: 1,
        weekdays: weekdays(),
        times: times(),
      };
    case 6:
      return {
        frequency: 'monthly',
        interval: pick([1, 2, 3, 4, 6, 12], 1),
        monthDay: 1 + int(28),
        times: times(),
      };
    default: {
      const month = 1 + int(12);
      const most = SURE_MONTH_DAYS[month - 1] ?? 28;
      return {
        frequency: 'yearly',
        interval: 1,
        month,
        monthDay: 1 + int(most),
        times: times(),
      };
    }
  }
}

/** Each zone's 2026 clock changes; Kolkata has none, so it is asked on
 * Zurich's days. */
const TRANSITIONS: [string, number[]][] = [
  [
    'Europe/Zurich',
    [Date.parse('2026-03-29T01:00Z'), Date.parse('2026-10-25T01:00Z')],
  ],
  [
    'America/New_York',
    [Date.parse('2026-03-08T07:00Z'), Date.parse('2026-11-01T06:00Z')],
  ],
  [
    'Australia/Lord_Howe',
    [Date.parse('2026-04-04T15:00Z'), Date.parse('2026-10-03T15:30Z')],
  ],
  [
    'Asia/Kolkata',
    [Date.parse('2026-03-29T01:00Z'), Date.parse('2026-10-25T01:00Z')],
  ],
];

/** How far before a clock change to start, so the starts compared run
 * across it. */
function leadOf(rule: ScheduleRule): number {
  if (rule.frequency === 'minutely') return 3 * rule.interval * MINUTE;
  if (rule.frequency === 'hourly') return 3 * rule.interval * HOUR;
  return 2 * DAY;
}

const iso = (ms: number) => new Date(ms).toISOString();

describe('a rule and its cron start at the same instants', () => {
  it('agrees for 1,000 seeded rules around every 2026 clock change of four zones', () => {
    const random = seeded(10_08_2026);
    const mismatches: string[] = [];
    let compared = 0;
    for (let i = 0; i < 1000; i += 1) {
      const rule = losslessRule(random);
      const expression = scheduleRuleToCron(rule, JANUARY);
      if (expression === null) {
        mismatches.push(`no cron for ${JSON.stringify(rule)}`);
        continue;
      }
      const cron = parseCron(expression);
      const grid = rule.frequency === 'minutely' || rule.frequency === 'hourly';
      if (cronDstClass(cron) !== (grid ? 'grid' : 'named')) {
        mismatches.push(
          `${expression} is in the other DST class than ${JSON.stringify(rule)}`,
        );
      }
      const back = cronToScheduleRule(expression);
      if (back === null) mismatches.push(`${expression} reads back as no rule`);
      for (const [zone, changes] of TRANSITIONS) {
        const asRule: Schedule = {
          type: 'rule',
          rule,
          timezone: zone,
          startDate: JANUARY,
        };
        const asCron: Schedule = {
          type: 'cron',
          cron,
          timezone: zone,
          dstClass: cronDstClass(cron),
        };
        for (const change of changes) {
          for (const start of [change - leadOf(rule), change - 20 * DAY]) {
            compared += 1;
            const mine = occurrencesAfter(asRule, start, 6);
            const theirs = occurrencesAfter(asCron, start, 6);
            if (mine.join() !== theirs.join()) {
              mismatches.push(
                `${JSON.stringify(rule)} vs "${expression}" in ${zone} after ${iso(start)}: ${mine.map(iso).join(' ')} | ${theirs.map(iso).join(' ')}`,
              );
            }
          }
        }
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
    expect(compared).toBe(1000 * 4 * 2 * 2);
  });

  it('agrees with the scan matcher it replaces, on ordinary days', () => {
    const random = seeded(2026_10_08);
    const zones = TRANSITIONS.map(([zone]) => zone);
    const mismatches: string[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const rule = losslessRule(random);
      const expression = scheduleRuleToCron(rule, JANUARY);
      if (expression === null) continue;
      const zone = zones[i % zones.length] ?? 'UTC';
      const cron = parseCron(expression);
      const schedule: Schedule = {
        type: 'cron',
        cron,
        timezone: zone,
        dstClass: cronDstClass(cron),
      };
      // June 2026: no zone here changes its clock.
      const start =
        Date.parse('2026-06-10T00:00Z') + Math.floor(random() * DAY);
      for (const next of occurrencesAfter(schedule, start, 2)) {
        // Nothing between the start before it and it, and it is a start.
        const before = previousOccurrence(schedule, next - 1) ?? start;
        const from = Math.max(before, next - 2 * DAY);
        const legacy = firstOccurrenceBetween(cron, zone, from, next);
        if (legacy !== next) {
          mismatches.push(
            `"${expression}" in ${zone}: ${iso(next)}, the scan matcher ${legacy === null ? 'none' : iso(legacy)} after ${iso(from)}`,
          );
        }
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
  });
});
