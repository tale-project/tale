/**
 * The design system's schedule rule and the platform's are two copies of one
 * concept: `@tale/ui` cannot import the platform's schema, so the time-mode
 * repeat picker keeps its own type, constants, normalization and equality
 * (`@tale/ui/recurrence-schedule`) beside the zod source every door parses
 * with (`@tale/shared/schemas/schedule-rule`). This suite keeps them from
 * drifting: every rule the picker can emit is one the schema stores, the
 * rules the picker refuses to save are exactly the ones the schema refuses
 * as never running, both sides spell and compare rules the same way, and the
 * picker's day rules stay task rules once their times are stripped.
 */
import {
  formatScheduleTime as sharedFormatTime,
  normalizeScheduleRule,
  parseScheduleTime as sharedParseTime,
  SCHEDULE_HOUR_INTERVALS as SHARED_HOUR_INTERVALS,
  SCHEDULE_MAX_INTERVAL as SHARED_MAX_INTERVAL,
  SCHEDULE_MAX_TIMES as SHARED_MAX_TIMES,
  SCHEDULE_MINUTE_INTERVALS as SHARED_MINUTE_INTERVALS,
  SCHEDULE_TIME_PATTERN as SHARED_TIME_PATTERN,
  type ScheduleRule as SharedScheduleRule,
  sameScheduleRule,
  scheduleIssueCode,
  scheduleRuleSchema,
} from '@tale/shared/schemas/schedule-rule';
import { maxMonthDay, RECURRENCE_FREQUENCIES } from '@tale/ui/recurrence';
import {
  formatScheduleTime,
  isScheduleGrid,
  normalizeSchedule,
  parseScheduleTime,
  SCHEDULE_HOUR_INTERVALS,
  SCHEDULE_MAX_INTERVAL,
  SCHEDULE_MAX_TIMES,
  SCHEDULE_MINUTE_INTERVALS,
  SCHEDULE_PRESETS,
  SCHEDULE_TIME_PATTERN,
  type ScheduleDraft,
  scheduleDays,
  scheduleDraft,
  scheduleFromDraft,
  type ScheduleOccurrence,
  schedulePreset,
  type ScheduleReference,
  type ScheduleRule,
  sameSchedule,
  windowStarts,
} from '@tale/ui/recurrence-schedule';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { taskRepeatSchema } from '../../shared/task-repeat';
import type { ScheduleOccurrenceData } from './occurrences';

const ZONE = 'Europe/Zurich';
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const REFERENCE: ScheduleReference = {
  year: 2028,
  month: 2,
  day: 29,
  weekday: 2,
};

/** Every non-empty set of weekdays, as `Date#getDay` numbers. */
function weekdaySubsets(): number[][] {
  const subsets: number[][] = [];
  for (let mask = 1; mask < 1 << 7; mask += 1) {
    subsets.push(ALL_DAYS.filter((day) => mask & (1 << day)));
  }
  return subsets;
}

const at = (hour: number, minute = 0) => ({ hour, minute });

/** Hours an author can give a window: none, same day, overnight, until
 *  midnight, and the same start and end (all day). */
const WINDOW_HOURS: ScheduleDraft['windowHours'][] = [
  null,
  { from: at(8), to: at(18) },
  { from: at(9, 10), to: at(9, 20) },
  { from: at(22), to: at(6) },
  { from: at(18), to: at(0) },
  { from: at(7), to: at(11) },
  { from: at(0), to: at(23, 59) },
  { from: at(8), to: at(8) },
];

/** A draft to edit, from the picker's own seed. */
function baseDraft(): ScheduleDraft {
  return scheduleDraft(null, REFERENCE);
}

/** Every grid the Custom interval view can produce, as it emits them. */
function intervalRules(): ScheduleRule[] {
  const rules: ScheduleRule[] = [];
  const days = weekdaySubsets().filter((_, index) => index % 9 === 0);
  days.push(ALL_DAYS, [1, 2, 3, 4, 5]);
  for (const windowDays of days) {
    for (const windowHours of WINDOW_HOURS) {
      for (const minutes of SCHEDULE_MINUTE_INTERVALS) {
        rules.push(
          scheduleFromDraft(
            {
              ...baseDraft(),
              every: { unit: 'minutely', minutes, hours: 1 },
              windowDays,
              windowHours,
            },
            'interval',
          ),
        );
      }
      for (const hours of SCHEDULE_HOUR_INTERVALS) {
        for (const minutePast of [0, 15, 59]) {
          rules.push(
            scheduleFromDraft(
              {
                ...baseDraft(),
                every: { unit: 'hourly', minutes: 15, hours },
                minutePast,
                windowDays,
                windowHours,
              },
              'interval',
            ),
          );
        }
      }
    }
  }
  return rules;
}

/** The times lists an author can draft: one, two out of order, a repeat,
 *  the most, and midnight. */
const TIME_LISTS = [
  [at(9)],
  [at(17, 30), at(9)],
  [at(9), at(9), at(12)],
  Array.from({ length: SCHEDULE_MAX_TIMES }, (_, index) => at(index * 2)),
  [at(0)],
];

/** Every times rule the Custom times view can produce, as it emits them. */
function timesRules(): ScheduleRule[] {
  const rules: ScheduleRule[] = [];
  const calendar = baseDraft().calendar;
  const days = (patch: Partial<ScheduleDraft['calendar']>) => ({
    ...calendar,
    ...patch,
  });
  for (const times of TIME_LISTS) {
    for (const interval of [1, 2, SCHEDULE_MAX_INTERVAL]) {
      const drafts = [
        days({ frequency: 'daily', interval }),
        ...weekdaySubsets()
          .filter((_, index) => index % 5 === 0)
          .map((weekdays) => days({ frequency: 'weekly', interval, weekdays })),
        ...[1, 28, 29, 30, 31].map((monthDay) =>
          days({ frequency: 'monthly', interval, monthDay }),
        ),
        ...Array.from({ length: 12 }, (_, index) =>
          days({
            frequency: 'yearly',
            interval,
            yearMonth: index + 1,
            yearDay: maxMonthDay(index + 1),
          }),
        ),
      ];
      for (const draft of drafts) {
        rules.push(
          scheduleFromDraft(
            { ...baseDraft(), calendar: draft, times },
            'times',
          ),
        );
      }
    }
  }
  return rules;
}

/** Every preset, read off every day of a leap year, at three times. */
function presetRules(): ScheduleRule[] {
  const rules: ScheduleRule[] = [];
  for (let month = 1; month <= 12; month += 1) {
    for (let day = 1; day <= maxMonthDay(month); day += 1) {
      const weekday = new Date(Date.UTC(2028, month - 1, day)).getUTCDay();
      for (const time of ['00:00', '09:00', '23:59']) {
        const reference = { year: 2028, month, day, weekday, time };
        for (const preset of SCHEDULE_PRESETS) {
          rules.push(schedulePreset(preset, reference));
        }
      }
    }
  }
  return rules;
}

/** Whether the picker lets the rule be saved: a grid must run somewhere. */
function savable(rule: ScheduleRule): boolean {
  return !isScheduleGrid(rule) || windowStarts(rule) !== null;
}

describe('the schedule picker and the schedule rule schema', () => {
  const emitted = [...intervalRules(), ...timesRules(), ...presetRules()];

  it('emit enough rules to say something', () => {
    expect(intervalRules().length).toBeGreaterThan(1000);
    expect(timesRules().length).toBeGreaterThan(500);
    expect(presetRules().length).toBe(366 * 3 * SCHEDULE_PRESETS.length);
  });

  it('store every rule the picker lets you save', () => {
    const refused = emitted
      .filter(savable)
      .map((rule) => ({ rule, result: scheduleRuleSchema.safeParse(rule) }))
      .filter(({ result }) => !result.success)
      .map(({ rule, result }) => ({
        rule,
        issues: result.error?.issues.map((issue) => issue.message),
      }));
    expect(refused).toEqual([]);
  });

  it('refuse exactly the windows the picker will not save, as never running', () => {
    const blocked = emitted.filter((rule) => !savable(rule));
    expect(blocked.length).toBeGreaterThan(0);
    const codes = blocked.map((rule) => {
      const result = scheduleRuleSchema.safeParse(rule);
      return result.success
        ? 'accepted'
        : result.error.issues.map(scheduleIssueCode).join(',');
    });
    expect(new Set(codes)).toEqual(new Set(['schedule.window_never_fires']));
  });

  it('never send hours that start where they end', () => {
    const equal = emitted.filter(
      (rule) =>
        isScheduleGrid(rule) &&
        rule.window?.hours !== undefined &&
        rule.window.hours.from === rule.window.hours.to,
    );
    expect(equal).toEqual([]);
  });

  it('emit rules already in the schema’s one spelling', () => {
    const respelled = emitted.filter(
      (rule) =>
        JSON.stringify(normalizeScheduleRule(rule)) !== JSON.stringify(rule),
    );
    expect(respelled).toEqual([]);
  });

  it('spell a rule the same way, however it came in', () => {
    const messy: ScheduleRule[] = [
      {
        frequency: 'weekly',
        interval: 1,
        weekdays: [5, 1, 5],
        times: ['17:30', '09:00', '17:30'],
      },
      {
        frequency: 'minutely',
        interval: 15,
        window: { weekdays: [6, 0, 1, 2, 3, 4, 5] },
      },
      {
        frequency: 'hourly',
        interval: 2,
        minute: 15,
        window: { weekdays: [3, 1], hours: { from: '08:00', to: '08:00' } },
      },
      {
        frequency: 'minutely',
        interval: 30,
        window: { weekdays: ALL_DAYS, hours: { from: '22:00', to: '06:00' } },
      },
    ];
    for (const rule of [
      ...messy,
      ...emitted.filter((_, index) => index % 13 === 0),
    ]) {
      expect(normalizeSchedule(rule)).toEqual(normalizeScheduleRule(rule));
    }
  });

  it('call the same rules equal', () => {
    const sample = emitted.filter((_, index) => index % 97 === 0).slice(0, 90);
    const disagreements: [ScheduleRule, ScheduleRule][] = [];
    for (const a of sample) {
      for (const b of sample) {
        if (sameSchedule(a, b) !== sameScheduleRule(a, b)) {
          disagreements.push([a, b]);
        }
      }
    }
    // Spelled differently, meaning the same.
    const a: ScheduleRule = {
      frequency: 'daily',
      interval: 1,
      times: ['17:00', '09:00'],
    };
    const b: ScheduleRule = {
      frequency: 'daily',
      interval: 1,
      times: ['09:00', '17:00', '09:00'],
    };
    expect(sameSchedule(a, b)).toBe(true);
    expect(sameScheduleRule(a, b)).toBe(true);
    expect(disagreements).toEqual([]);
  });

  it('read and write times the same way', () => {
    expect(String(SCHEDULE_TIME_PATTERN)).toBe(String(SHARED_TIME_PATTERN));
    for (const text of ['00:00', '09:05', '23:59', '24:00', '9:05', '12:60']) {
      expect(parseScheduleTime(text)).toEqual(sharedParseTime(text));
    }
    for (let minute = 0; minute < 24 * 60; minute += 7) {
      const time = { hour: Math.floor(minute / 60), minute: minute % 60 };
      expect(formatScheduleTime(time)).toBe(sharedFormatTime(time));
    }
  });

  it('offer the steps, limits and frequencies the schema stores', () => {
    expect(SCHEDULE_MINUTE_INTERVALS).toEqual(SHARED_MINUTE_INTERVALS);
    expect(SCHEDULE_HOUR_INTERVALS).toEqual(SHARED_HOUR_INTERVALS);
    expect(SCHEDULE_MAX_TIMES).toBe(SHARED_MAX_TIMES);
    expect(SCHEDULE_MAX_INTERVAL).toBe(SHARED_MAX_INTERVAL);
    const stored = scheduleRuleSchema.options
      .map((branch) => branch.shape.frequency.value)
      .toSorted();
    expect(stored).toEqual(
      ['minutely', 'hourly', ...RECURRENCE_FREQUENCIES].toSorted(),
    );
  });

  it('keep a task rule under every day rule the picker emits', () => {
    const refused = emitted.filter(
      (rule) =>
        !isScheduleGrid(rule) &&
        !taskRepeatSchema.safeParse({ ...scheduleDays(rule), timezone: ZONE })
          .success,
    );
    expect(refused).toEqual([]);
  });

  it('accept each other’s rules and the preview’s starts', () => {
    expectTypeOf<SharedScheduleRule>().toExtend<ScheduleRule>();
    expectTypeOf<ScheduleRule>().toExtend<SharedScheduleRule>();
    expectTypeOf<ScheduleOccurrenceData>().toExtend<ScheduleOccurrence>();
  });
});
