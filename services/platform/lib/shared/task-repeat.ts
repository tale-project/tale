/**
 * Repeating tasks — the one rule shape and calendar arithmetic shared by the
 * backend (validating a write, dating the next copy when a repeating task
 * closes) and the app (the Repeat field's reference day, the next due dates
 * it lists and the first due date it sets), so the date the panel promises
 * is the date the server writes. The words and the one-click presets are
 * `@tale/ui/recurrence`'s: the backend cannot import the design system.
 *
 * A rule names WHICH calendar days a task recurs on, never a time of day:
 * task dates are local midnights (`@tale/ui/date-picker` stores
 * `startOfDay`), so every step walks calendar dates in the rule's own IANA
 * zone — the zone of the person who set it — and lands on that zone's
 * midnight again. A weekly task due Monday stays due Monday across a DST
 * change.
 *
 * The anchors (weekday, day of month, month) live IN the rule rather than
 * being read off the task's due date, so moving one occurrence's due date
 * never rewrites the series, and a monthly rule on the 31st keeps the 31st
 * after a short month clamps one occurrence to the 30th.
 */

import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { z } from 'zod';

import {
  addDays,
  type CalendarDate,
  calendarRangeError,
  daysBetween,
  firstRuleDay,
  isAfter,
  stepAfter,
  toUtc,
  validInstant,
} from './calendar.ts';

export { type CalendarDate, weekdayOf } from './calendar.ts';

const DAY_MS = 86_400_000;
const HALF_DAY_MS = DAY_MS / 2;

dayjs.extend(utc);
dayjs.extend(timezone);

/** "Every 99 weeks" is the widest step the custom form offers. */
export const TASK_REPEAT_MAX_INTERVAL = 99;

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

const intervalSchema = z.number().int().min(1).max(TASK_REPEAT_MAX_INTERVAL);
const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isTimeZone, 'Unknown time zone');

const DAYS_IN_MONTH_MAX = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * When the next copy is created. `close` (the default, and what an absent
 * key means): when this copy is done or cancelled. `dueDate`: that too, and
 * at the start of the due date if this copy is still open then — for work
 * that is owed every period whether or not the last one was finished, such
 * as a monthly compliance review.
 */
export const TASK_REPEAT_CREATE_ON = ['close', 'dueDate'] as const;

export type TaskRepeatCreateOn = (typeof TASK_REPEAT_CREATE_ON)[number];

const createOnSchema = z.enum(TASK_REPEAT_CREATE_ON).optional();

export const taskRepeatSchema = z.discriminatedUnion('frequency', [
  z
    .object({
      frequency: z.literal('daily'),
      interval: intervalSchema,
      timezone: timezoneSchema,
      createOn: createOnSchema,
    })
    .strict(),
  z
    .object({
      frequency: z.literal('weekly'),
      interval: intervalSchema,
      /** `Date#getDay` numbers: 0 is Sunday, 6 is Saturday. */
      weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      timezone: timezoneSchema,
      createOn: createOnSchema,
    })
    .strict()
    .refine(
      (rule) => new Set(rule.weekdays).size === rule.weekdays.length,
      'Weekdays repeat',
    ),
  z
    .object({
      frequency: z.literal('monthly'),
      interval: intervalSchema,
      /** Clamped to a shorter month's last day, never skipped. */
      monthDay: z.number().int().min(1).max(31),
      timezone: timezoneSchema,
      createOn: createOnSchema,
    })
    .strict(),
  z
    .object({
      frequency: z.literal('yearly'),
      interval: intervalSchema,
      /** 1 is January. */
      month: z.number().int().min(1).max(12),
      /** Feb 29 lands on Feb 28 in a common year. */
      monthDay: z.number().int().min(1).max(31),
      timezone: timezoneSchema,
      createOn: createOnSchema,
    })
    .strict()
    .refine(
      (rule) => rule.monthDay <= (DAYS_IN_MONTH_MAX[rule.month - 1] ?? 31),
      'No such day in that month',
    ),
]);

export type TaskRepeat = z.infer<typeof taskRepeatSchema>;

/** A stored rule read back leniently: anything that no longer validates
 * (a zone the runtime dropped, a hand-edited row) reads as no rule rather
 * than breaking the board. */
export function parseTaskRepeat(value: unknown): TaskRepeat | null {
  if (value === null || value === undefined) return null;
  const parsed = taskRepeatSchema.safeParse(value);
  return parsed.success ? normalizeTaskRepeat(parsed.data) : null;
}

/** When a rule creates its next copy; an absent key is `close`. */
export function taskRepeatCreateOn(rule: TaskRepeat): TaskRepeatCreateOn {
  return rule.createOn ?? 'close';
}

/** Weekdays deduplicated and in `getDay` order, so two rules naming the
 * same days compare equal; `createOn` is kept only when it is not the
 * default, so a stored rule and its activity lines carry it only when it
 * matters. */
export function normalizeTaskRepeat(rule: TaskRepeat): TaskRepeat {
  const { createOn, ...rest } = rule;
  const base: TaskRepeat =
    createOn === 'dueDate' ? { ...rest, createOn } : { ...rest };
  if (base.frequency !== 'weekly') return base;
  return {
    ...base,
    weekdays: [...new Set(base.weekdays)].toSorted((a, b) => a - b),
  };
}

/** Same days, same step, same moment of creation — the zone is where the
 * rule was set, not what it says, so it does not take part. */
export function sameTaskRepeat(
  a: TaskRepeat | null | undefined,
  b: TaskRepeat | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  const x = normalizeTaskRepeat(a);
  const y = normalizeTaskRepeat(b);
  if (x.frequency !== y.frequency || x.interval !== y.interval) return false;
  if (taskRepeatCreateOn(x) !== taskRepeatCreateOn(y)) return false;
  switch (x.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      return (
        y.frequency === 'weekly' &&
        x.weekdays.length === y.weekdays.length &&
        x.weekdays.every((day, i) => day === y.weekdays[i])
      );
    case 'monthly':
      return y.frequency === 'monthly' && x.monthDay === y.monthDay;
    case 'yearly':
      return (
        y.frequency === 'yearly' &&
        x.month === y.month &&
        x.monthDay === y.monthDay
      );
  }
}

// ---------------------------------------------------------------------------
// Calendar dates
// ---------------------------------------------------------------------------

/** The calendar day an instant falls on in `timeZone`. */
export function calendarDateIn(ms: number, timeZone: string): CalendarDate {
  const local = dayjs(validInstant(ms)).tz(timeZone);
  if (!local.isValid()) throw calendarRangeError();
  return { year: local.year(), month: local.month() + 1, day: local.date() };
}

/**
 * The calendar day a stored task date names, read in `timeZone`. A task
 * date is a local midnight — but in the zone of whoever picked it, which
 * need not be the rule's: Tuesday 00:00 in Zurich is still Monday afternoon
 * in Los Angeles. Reading the instant at its NEAREST midnight names the day
 * the picker meant for any two zones less than twelve hours apart.
 */
export function taskDateIn(ms: number, timeZone: string): CalendarDate {
  return calendarDateIn(ms + HALF_DAY_MS, timeZone);
}

/** Today's midnight in `timeZone` — the reference a task with no due date
 *  reads its one-click presets off. */
export function startOfTodayIn(timeZone: string, now: number): number {
  return startOfCalendarDate(calendarDateIn(now, timeZone), timeZone);
}

/** Midnight at the start of `date` in `timeZone`, as epoch ms. */
export function startOfCalendarDate(
  date: CalendarDate,
  timeZone: string,
): number {
  // Day.js' zone parser shifts extended ISO years instead of preserving
  // midnight. Refuse that unsupported representation rather than invent a
  // time-zone conversion or silently change the requested calendar date.
  if (date.year > 9999 || date.year < 100) throw calendarRangeError();
  const iso = new Date(toUtc(date)).toISOString().split('T')[0];
  return validInstant(dayjs.tz(iso, timeZone).valueOf());
}

/** Enough steps to walk a daily rule across centuries; past it the rule
 * restarts from today instead of spinning. */
const MAX_CATCH_UP_STEPS = 100_000;

/**
 * The due date a task starts on when it is given a rule and has none yet:
 * the first day the rule names on or after today — or on or after its start
 * date, when that is later, so the due date never lands before the start.
 * The step is ignored here: "every 2 weeks on Monday" set on a Monday is
 * due today, not in a fortnight.
 */
export function firstTaskRepeatOccurrence(
  rule: TaskRepeat,
  now: number,
  startDate?: number | null,
): number {
  const today = calendarDateIn(now, rule.timezone);
  const start =
    typeof startDate === 'number' ? taskDateIn(startDate, rule.timezone) : null;
  const from = start && isAfter(start, today) ? start : today;
  return startOfCalendarDate(firstRuleDay(rule, from), rule.timezone);
}

/**
 * The occurrence after `anchor` (the closing copy's due date): the rule's
 * next day strictly after the anchor's day, walked forward until it is no
 * longer in the past — a weekly task closed a week late comes back due this
 * week, not already overdue. Anchoring on the due date, not the close,
 * keeps the series on its days whether a copy closes early or late.
 */
export function nextTaskRepeatOccurrence(
  rule: TaskRepeat,
  anchor: number,
  now: number,
): number {
  const today = calendarDateIn(now, rule.timezone);
  let next = stepAfter(rule, taskDateIn(anchor, rule.timezone));
  for (let i = 0; !isAfter(next, addDays(today, -1)); i += 1) {
    if (i >= MAX_CATCH_UP_STEPS) {
      return firstTaskRepeatOccurrence(rule, now);
    }
    next = stepAfter(rule, next);
  }
  return startOfCalendarDate(next, rule.timezone);
}

/**
 * The next copy's dates. The due date steps to the next occurrence and a
 * start date keeps its lead (in calendar days) before it. A copy with only
 * a start date steps that instead; a copy with neither is dated from today.
 */
export function nextTaskRepeatDates(
  rule: TaskRepeat,
  dates: { startDate?: number | null; dueDate?: number | null },
  now: number,
): { startDate: number | null; dueDate: number | null } {
  const { startDate, dueDate } = dates;
  if (typeof dueDate === 'number') {
    const due = nextTaskRepeatOccurrence(rule, dueDate, now);
    if (typeof startDate !== 'number') return { startDate: null, dueDate: due };
    const lead = daysBetween(
      taskDateIn(startDate, rule.timezone),
      taskDateIn(dueDate, rule.timezone),
    );
    const start = addDays(calendarDateIn(due, rule.timezone), -lead);
    return {
      startDate: startOfCalendarDate(start, rule.timezone),
      dueDate: due,
    };
  }
  if (typeof startDate === 'number') {
    return {
      startDate: nextTaskRepeatOccurrence(rule, startDate, now),
      dueDate: null,
    };
  }
  return {
    startDate: null,
    dueDate: nextTaskRepeatOccurrence(
      rule,
      startOfTodayIn(rule.timezone, now),
      now,
    ),
  };
}

/**
 * What a rule would do to a task, for the picker to show before it is
 * saved: the due date this copy has (or gets — the first matching day, when
 * it has none yet) and the due dates of the next `count` copies after it,
 * each stepped the way a close steps it.
 */
export function upcomingTaskRepeatDates(
  rule: TaskRepeat,
  dates: { startDate?: number | null; dueDate?: number | null },
  now: number,
  count = 3,
): { dueDate: number; next: number[] } {
  const dueDate =
    typeof dates.dueDate === 'number'
      ? dates.dueDate
      : firstTaskRepeatOccurrence(rule, now, dates.startDate);
  const next: number[] = [];
  let anchor = dueDate;
  for (let i = 0; i < count; i += 1) {
    anchor = nextTaskRepeatOccurrence(rule, anchor, now);
    next.push(anchor);
  }
  return { dueDate, next };
}

/** The zone this runtime reads dates in — the browser's, in the app. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
