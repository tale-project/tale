/**
 * The design system's recurrence rules and the task's stored rule are two
 * copies of one concept: the backend cannot import `@tale/ui` at runtime, so
 * the frequency list, the widest step, the days in each month and rule
 * equality live on both sides. This suite keeps them from drifting — every
 * rule the picker can emit is one the task schema stores, and both sides call
 * the same two rules equal.
 */
import {
  maxMonthDay,
  normalizeRecurrence,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_MAX_INTERVAL,
  RECURRENCE_PRESETS,
  recurrenceFromDraft,
  recurrencePreset,
  type RecurrenceRule,
  sameRecurrence,
} from '@tale/ui/recurrence';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  sameTaskRepeat,
  TASK_REPEAT_MAX_INTERVAL,
  type TaskRepeat,
  taskRepeatSchema,
} from './task-repeat';

const ZONE = 'Europe/Zurich';
const INTERVALS = [1, 2, RECURRENCE_MAX_INTERVAL];

/** Every non-empty set of weekdays, as `Date#getDay` numbers. */
function weekdaySubsets(): number[][] {
  const subsets: number[][] = [];
  for (let mask = 1; mask < 1 << 7; mask += 1) {
    subsets.push([0, 1, 2, 3, 4, 5, 6].filter((day) => mask & (1 << day)));
  }
  return subsets;
}

/** Every (month, day) a yearly rule can name — February 29 included. */
function monthDays(): { month: number; monthDay: number }[] {
  const pairs: { month: number; monthDay: number }[] = [];
  for (let month = 1; month <= 12; month += 1) {
    for (let monthDay = 1; monthDay <= maxMonthDay(month); monthDay += 1) {
      pairs.push({ month, monthDay });
    }
  }
  return pairs;
}

/** Every rule the picker's custom editor can produce, as it emits them. */
function editorRules(): RecurrenceRule[] {
  const rules: RecurrenceRule[] = [];
  const base = { weekdays: [1], monthDay: 1, yearMonth: 1, yearDay: 1 };
  for (const interval of INTERVALS) {
    rules.push(
      recurrenceFromDraft({ ...base, frequency: 'daily', interval }),
      ...weekdaySubsets().map((weekdays) =>
        recurrenceFromDraft({
          ...base,
          frequency: 'weekly',
          interval,
          weekdays,
        }),
      ),
    );
    for (let monthDay = 1; monthDay <= 31; monthDay += 1) {
      rules.push(
        recurrenceFromDraft({
          ...base,
          frequency: 'monthly',
          interval,
          monthDay,
        }),
      );
    }
    for (const { month, monthDay } of monthDays()) {
      rules.push(
        recurrenceFromDraft({
          ...base,
          frequency: 'yearly',
          interval,
          yearMonth: month,
          yearDay: monthDay,
        }),
      );
    }
  }
  return rules.map(normalizeRecurrence);
}

/** Every preset, read off every day of a leap year. */
function presetRules(): RecurrenceRule[] {
  const rules: RecurrenceRule[] = [];
  for (const { month, monthDay } of monthDays()) {
    const weekday = new Date(Date.UTC(2028, month - 1, monthDay)).getUTCDay();
    const reference = { year: 2028, month, day: monthDay, weekday };
    for (const preset of RECURRENCE_PRESETS) {
      rules.push(normalizeRecurrence(recurrencePreset(preset, reference)));
    }
  }
  return rules;
}

describe('the picker and the task schema', () => {
  it('store every rule the picker can emit, once a zone is added', () => {
    const refused = [...editorRules(), ...presetRules()].filter(
      (rule) =>
        !taskRepeatSchema.safeParse({ ...rule, timezone: ZONE }).success,
    );
    expect(refused).toEqual([]);
  });

  it('offer every frequency the schema stores, and nothing else', () => {
    const stored = taskRepeatSchema.options.map(
      (branch) => branch.shape.frequency.value,
    );
    expect([...RECURRENCE_FREQUENCIES].toSorted()).toEqual(stored.toSorted());
  });

  it('step at most as far as the schema allows', () => {
    expect(RECURRENCE_MAX_INTERVAL).toBe(TASK_REPEAT_MAX_INTERVAL);
    expect(
      taskRepeatSchema.safeParse({
        frequency: 'daily',
        interval: RECURRENCE_MAX_INTERVAL + 1,
        timezone: ZONE,
      }).success,
    ).toBe(false);
  });

  it('agree on the last day of each month', () => {
    for (let month = 1; month <= 12; month += 1) {
      const rule = { frequency: 'yearly', interval: 1, month, timezone: ZONE };
      expect(
        taskRepeatSchema.safeParse({ ...rule, monthDay: maxMonthDay(month) })
          .success,
      ).toBe(true);
      expect(
        taskRepeatSchema.safeParse({
          ...rule,
          monthDay: maxMonthDay(month) + 1,
        }).success,
      ).toBe(false);
    }
  });

  // Without a creation mode, the two equalities are one: a picker that
  // thinks nothing changed never writes, and the server agrees.
  it('call the same rules equal', () => {
    const sample = [
      ...editorRules().filter((_, index) => index % 7 === 0),
      ...presetRules().filter((_, index) => index % 11 === 0),
    ];
    const pairs: [RecurrenceRule, RecurrenceRule][] = [];
    for (const a of sample.slice(0, 120)) {
      for (const b of sample.slice(0, 120)) pairs.push([a, b]);
    }
    // Weekdays listed out of order or twice still name the same days.
    pairs.push([
      { frequency: 'weekly', interval: 1, weekdays: [4, 1] },
      { frequency: 'weekly', interval: 1, weekdays: [1, 4] },
    ]);
    const disagreements = pairs.filter(([a, b]) => {
      const x: TaskRepeat = { ...a, timezone: ZONE };
      const y: TaskRepeat = { ...b, timezone: 'America/New_York' };
      return sameRecurrence(a, b) !== sameTaskRepeat(x, y);
    });
    expect(disagreements).toEqual([]);
  });

  it('accept a stored rule wherever the picker takes one', () => {
    expectTypeOf<TaskRepeat>().toExtend<RecurrenceRule>();
  });
});
