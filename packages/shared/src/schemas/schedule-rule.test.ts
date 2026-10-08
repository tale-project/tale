import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import {
  formatScheduleTime,
  gridMinuteAtOrAfter,
  gridMinuteAtOrBefore,
  normalizeScheduleRule,
  parseScheduleTime,
  SCHEDULE_ISSUE_CODES,
  type ScheduleIssueCode,
  scheduleIssueCode,
  type ScheduleRule,
  scheduleRuleSchema,
  sameScheduleRule,
  windowRangesOn,
} from './schedule-rule';

/** The codes a refusal of `value` carries, in order; null for a problem of
 * shape. */
function codesOf(value: unknown): (ScheduleIssueCode | null)[] {
  const parsed = scheduleRuleSchema.safeParse(value);
  if (parsed.success) return [];
  return parsed.error.issues.map(scheduleIssueCode);
}

describe('scheduleRuleSchema', () => {
  it.each<ScheduleRule>([
    { frequency: 'minutely', interval: 15 },
    {
      frequency: 'minutely',
      interval: 30,
      window: { weekdays: [5], hours: { from: '22:00', to: '06:00' } },
    },
    {
      frequency: 'minutely',
      interval: 5,
      window: { weekdays: [1, 2, 3, 4, 5] },
    },
    {
      frequency: 'minutely',
      interval: 10,
      window: { weekdays: [1], hours: { from: '18:00', to: '00:00' } },
    },
    { frequency: 'hourly', interval: 6, minute: 0 },
    {
      frequency: 'hourly',
      interval: 1,
      minute: 30,
      window: {
        weekdays: [1, 2, 3, 4, 5],
        hours: { from: '08:00', to: '18:00' },
      },
    },
    { frequency: 'daily', interval: 1, times: ['09:00'] },
    { frequency: 'daily', interval: 99, times: ['00:00', '23:59'] },
    { frequency: 'weekly', interval: 2, weekdays: [2, 4], times: ['17:30'] },
    { frequency: 'monthly', interval: 1, monthDay: 31, times: ['09:00'] },
    {
      frequency: 'yearly',
      interval: 1,
      month: 2,
      monthDay: 29,
      times: ['09:00'],
    },
    {
      frequency: 'daily',
      interval: 1,
      times: Array.from(
        { length: 12 },
        (_, i) => `${String(i * 2).padStart(2, '0')}:00`,
      ),
    },
  ])('takes %j as it is', (rule) => {
    expect(scheduleRuleSchema.parse(rule)).toEqual(rule);
  });

  it.each<[string, unknown, ScheduleIssueCode]>([
    [
      'an unpadded time',
      { frequency: 'daily', interval: 1, times: ['9:00'] },
      'schedule.time_format',
    ],
    [
      '24:00',
      { frequency: 'daily', interval: 1, times: ['24:00'] },
      'schedule.time_format',
    ],
    [
      'minute 60',
      { frequency: 'daily', interval: 1, times: ['12:60'] },
      'schedule.time_format',
    ],
    [
      'a window hour that is no time',
      {
        frequency: 'minutely',
        interval: 15,
        window: { weekdays: [1], hours: { from: '8:00', to: '18:00' } },
      },
      'schedule.time_format',
    ],
    [
      'no time of day',
      { frequency: 'weekly', interval: 1, weekdays: [1], times: [] },
      'schedule.times_required',
    ],
    [
      'thirteen times',
      {
        frequency: 'daily',
        interval: 1,
        times: Array.from(
          { length: 13 },
          (_, i) => `${String(i).padStart(2, '0')}:00`,
        ),
      },
      'schedule.times_too_many',
    ],
    [
      'every 7 minutes',
      { frequency: 'minutely', interval: 7 },
      'schedule.interval_unsupported',
    ],
    [
      'every 5 hours',
      { frequency: 'hourly', interval: 5, minute: 0 },
      'schedule.interval_unsupported',
    ],
    [
      'every 0 days',
      { frequency: 'daily', interval: 0, times: ['09:00'] },
      'schedule.interval_unsupported',
    ],
    [
      'every 100 days',
      { frequency: 'daily', interval: 100, times: ['09:00'] },
      'schedule.interval_unsupported',
    ],
    [
      'every 1.5 days',
      { frequency: 'daily', interval: 1.5, times: ['09:00'] },
      'schedule.interval_unsupported',
    ],
    [
      'February 30',
      {
        frequency: 'yearly',
        interval: 1,
        month: 2,
        monthDay: 30,
        times: ['09:00'],
      },
      'schedule.month_day_impossible',
    ],
    [
      'April 31',
      {
        frequency: 'yearly',
        interval: 1,
        month: 4,
        monthDay: 31,
        times: ['09:00'],
      },
      'schedule.month_day_impossible',
    ],
    [
      'hours that start and end together',
      {
        frequency: 'minutely',
        interval: 15,
        window: { weekdays: [1], hours: { from: '09:00', to: '09:00' } },
      },
      'schedule.window_hours_equal',
    ],
    [
      'half-hourly from 23:45 until midnight',
      {
        frequency: 'minutely',
        interval: 30,
        window: { weekdays: [1], hours: { from: '23:45', to: '00:00' } },
      },
      'schedule.window_never_fires',
    ],
    [
      'hourly at :30 between 09:00 and 09:30',
      {
        frequency: 'hourly',
        interval: 1,
        minute: 30,
        window: { weekdays: [1], hours: { from: '09:00', to: '09:30' } },
      },
      'schedule.window_never_fires',
    ],
    [
      'every 6 hours between 07:00 and 11:00',
      {
        frequency: 'hourly',
        interval: 6,
        minute: 0,
        window: { weekdays: [1, 2], hours: { from: '07:00', to: '11:00' } },
      },
      'schedule.window_never_fires',
    ],
  ])('refuses %s as %s', (_name, value, code) => {
    expect(codesOf(value)).toContain(code);
  });

  it('carries the sentence a person can act on', () => {
    const parsed = scheduleRuleSchema.safeParse({
      frequency: 'daily',
      interval: 1,
      times: ['9:00'],
    });
    expect(parsed.error?.issues[0]).toMatchObject({
      path: ['times', 0],
      message: 'Write times as HH:MM, for example 09:30.',
    });
  });

  it('names a window that never fires on its hours', () => {
    const parsed = scheduleRuleSchema.safeParse({
      frequency: 'minutely',
      interval: 30,
      window: { weekdays: [1], hours: { from: '23:45', to: '00:00' } },
    });
    expect(parsed.error?.issues.map((found) => found.path)).toEqual([
      ['window', 'hours'],
    ]);
  });

  it('keeps an overnight window that has starts before midnight or after it', () => {
    expect(
      codesOf({
        frequency: 'minutely',
        interval: 30,
        window: { weekdays: [5], hours: { from: '23:45', to: '00:30' } },
      }),
    ).toEqual([]);
    expect(
      codesOf({
        frequency: 'hourly',
        interval: 12,
        minute: 0,
        window: { weekdays: [5], hours: { from: '13:00', to: '01:00' } },
      }),
    ).toEqual([]);
  });

  it.each<[string, unknown]>([
    [
      'an unknown key',
      { frequency: 'daily', interval: 1, times: ['09:00'], timezone: 'UTC' },
    ],
    [
      'a key of another frequency',
      { frequency: 'daily', interval: 1, times: ['09:00'], weekdays: [1] },
    ],
    ['an unknown frequency', { frequency: 'secondly', interval: 1 }],
    ['a time as a number', { frequency: 'daily', interval: 1, times: [900] }],
    [
      'a weekday past Saturday',
      { frequency: 'weekly', interval: 1, weekdays: [7], times: ['09:00'] },
    ],
    [
      'times on a grid',
      { frequency: 'minutely', interval: 15, times: ['09:00'] },
    ],
  ])('refuses %s as a problem of shape', (_name, value) => {
    const codes = codesOf(value);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.every((code) => code === null)).toBe(true);
  });

  it('describes itself to JSON Schema readers: one member per frequency, patterns and bounds', () => {
    const schema = JSON.stringify(
      z.toJSONSchema(scheduleRuleSchema, {
        target: 'draft-2020-12',
        io: 'input',
      }),
    );
    expect(JSON.parse(schema)).toMatchObject({
      oneOf: [{}, {}, {}, {}, {}, {}],
    });
    expect(schema).toContain(JSON.stringify(SCHEDULE_TIME_PATTERN_SOURCE));
    expect(schema).toContain('"maxItems":12');
    expect(schema).toContain('"enum":[1,2,3,4,5,6,10,12,15,20,30]');
    expect(schema).toContain('"enum":[1,2,3,4,6,8,12]');
    expect(schema).toContain('"additionalProperties":false');
  });

  it('infers the declared rule type', () => {
    expectTypeOf<
      z.output<typeof scheduleRuleSchema>
    >().toEqualTypeOf<ScheduleRule>();
  });
});

const SCHEDULE_TIME_PATTERN_SOURCE = '^([01]\\d|2[0-3]):[0-5]\\d$';

describe('scheduleIssueCode', () => {
  it('reads every code the schema can refuse with', () => {
    const seen = new Set<ScheduleIssueCode | null>();
    for (const value of [
      { frequency: 'daily', interval: 1, times: ['9:00'] },
      { frequency: 'daily', interval: 1, times: [] },
      {
        frequency: 'daily',
        interval: 1,
        times: Array.from({ length: 13 }, () => '09:00'),
      },
      { frequency: 'minutely', interval: 7 },
      {
        frequency: 'yearly',
        interval: 1,
        month: 6,
        monthDay: 31,
        times: ['09:00'],
      },
      {
        frequency: 'minutely',
        interval: 5,
        window: { weekdays: [1], hours: { from: '09:00', to: '09:00' } },
      },
      {
        frequency: 'minutely',
        interval: 30,
        window: { weekdays: [1], hours: { from: '23:31', to: '00:00' } },
      },
    ]) {
      for (const code of codesOf(value)) seen.add(code);
    }
    expect(seen).toEqual(new Set(SCHEDULE_ISSUE_CODES));
  });

  it('reads a path under a parent by its last key', () => {
    expect(
      scheduleIssueCode({
        code: 'too_small',
        origin: 'array',
        minimum: 1,
        inclusive: true,
        path: ['repeat', 'times'],
        message: 'Add at least one time of day.',
        input: [],
      }),
    ).toBe('schedule.times_required');
  });
});

describe('normalizeScheduleRule / sameScheduleRule', () => {
  it('sorts times and weekdays and drops repeats', () => {
    expect(
      normalizeScheduleRule({
        frequency: 'weekly',
        interval: 1,
        weekdays: [5, 1, 5, 3],
        times: ['17:30', '09:00', '17:30'],
      }),
    ).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [1, 3, 5],
      times: ['09:00', '17:30'],
    });
  });

  it('keeps only the keys its frequency has', () => {
    // A stored row read back may carry keys another frequency or a
    // caller left behind; a variable (not a literal) lets the test say so.
    const stored = {
      frequency: 'daily' as const,
      interval: 1,
      times: ['09:00'],
      weekdays: [1],
      timezone: 'UTC',
    };
    const loose: ScheduleRule = stored;
    expect(normalizeScheduleRule(loose)).toEqual({
      frequency: 'daily',
      interval: 1,
      times: ['09:00'],
    });
  });

  it('drops a window that limits nothing, and hours that cover all day', () => {
    expect(
      normalizeScheduleRule({
        frequency: 'minutely',
        interval: 15,
        window: { weekdays: [6, 5, 4, 3, 2, 1, 0] },
      }),
    ).toEqual({ frequency: 'minutely', interval: 15 });
    expect(
      normalizeScheduleRule({
        frequency: 'hourly',
        interval: 1,
        minute: 0,
        window: { weekdays: [1, 2], hours: { from: '08:00', to: '08:00' } },
      }),
    ).toEqual({
      frequency: 'hourly',
      interval: 1,
      minute: 0,
      window: { weekdays: [1, 2] },
    });
    expect(
      normalizeScheduleRule({
        frequency: 'minutely',
        interval: 15,
        window: {
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          hours: { from: '08:00', to: '18:00' },
        },
      }),
    ).toEqual({
      frequency: 'minutely',
      interval: 15,
      window: {
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        hours: { from: '08:00', to: '18:00' },
      },
    });
  });

  it('calls two spellings of one rule the same, and a different rule not', () => {
    expect(
      sameScheduleRule(
        { frequency: 'daily', interval: 1, times: ['17:30', '09:00'] },
        { frequency: 'daily', interval: 1, times: ['09:00', '17:30', '09:00'] },
      ),
    ).toBe(true);
    expect(
      sameScheduleRule(
        { frequency: 'minutely', interval: 15 },
        {
          frequency: 'minutely',
          interval: 15,
          window: { weekdays: [0, 1, 2, 3, 4, 5, 6] },
        },
      ),
    ).toBe(true);
    expect(
      sameScheduleRule(
        { frequency: 'hourly', interval: 1, minute: 0 },
        { frequency: 'hourly', interval: 1, minute: 30 },
      ),
    ).toBe(false);
    expect(
      sameScheduleRule(
        { frequency: 'daily', interval: 1, times: ['09:00'] },
        { frequency: 'daily', interval: 2, times: ['09:00'] },
      ),
    ).toBe(false);
    expect(sameScheduleRule(null, undefined)).toBe(true);
    expect(sameScheduleRule({ frequency: 'minutely', interval: 1 }, null)).toBe(
      false,
    );
  });
});

describe('times of day', () => {
  it('reads and writes HH:MM', () => {
    expect(parseScheduleTime('09:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseScheduleTime('23:59')).toEqual({ hour: 23, minute: 59 });
    expect(parseScheduleTime('24:00')).toBeNull();
    expect(parseScheduleTime('9:05')).toBeNull();
    expect(formatScheduleTime({ hour: 9, minute: 5 })).toBe('09:05');
    expect(formatScheduleTime({ hour: 0, minute: 0 })).toBe('00:00');
  });
});

describe('the wall-clock grid', () => {
  it('finds grid minutes aligned to midnight', () => {
    const quarter = { frequency: 'minutely', interval: 15 } as const;
    expect(gridMinuteAtOrAfter(quarter, 0)).toBe(0);
    expect(gridMinuteAtOrAfter(quarter, 61)).toBe(75);
    expect(gridMinuteAtOrAfter(quarter, 1426)).toBeNull();
    expect(gridMinuteAtOrBefore(quarter, 74)).toBe(60);
    const sixHourly = { frequency: 'hourly', interval: 6, minute: 30 } as const;
    expect(gridMinuteAtOrAfter(sixHourly, 0)).toBe(30);
    expect(gridMinuteAtOrAfter(sixHourly, 31)).toBe(390);
    expect(gridMinuteAtOrAfter(sixHourly, 1111)).toBeNull();
    expect(gridMinuteAtOrBefore(sixHourly, 29)).toBeNull();
    expect(gridMinuteAtOrBefore(sixHourly, 1439)).toBe(1110);
  });

  it('opens a day by its window: same day, overnight, the tail after midnight', () => {
    const office = { from: '08:00', to: '18:00' };
    expect(windowRangesOn(office, true, false)).toEqual([[480, 1080]]);
    expect(windowRangesOn(office, false, true)).toEqual([]);
    const night = { from: '22:00', to: '06:00' };
    expect(windowRangesOn(night, true, false)).toEqual([[1320, 1440]]);
    expect(windowRangesOn(night, false, true)).toEqual([[0, 360]]);
    expect(windowRangesOn(night, true, true)).toEqual([
      [0, 360],
      [1320, 1440],
    ]);
    const untilMidnight = { from: '18:00', to: '00:00' };
    expect(windowRangesOn(untilMidnight, true, true)).toEqual([[1080, 1440]]);
    expect(windowRangesOn(undefined, true, false)).toEqual([[0, 1440]]);
    expect(windowRangesOn(undefined, false, true)).toEqual([]);
  });
});
