import { z } from 'zod';

/**
 * A schedule's repeat rule — the one shape a schedule trigger is stored,
 * sent and edited in: the app's repeat picker, REST, MCP, automation packs
 * and managed configuration all carry it, and this module is its one zod
 * source. `@tale/ui/recurrence-schedule` keeps a type-level copy (the
 * design system cannot import the platform), and a parity test holds the
 * two together.
 *
 * The day frequencies are a task repeat rule plus `times`: strip `times`
 * and what is left reads, and steps, exactly as the task rule with the same
 * words. `minutely` and `hourly` are grids aligned to local midnight, with
 * an optional window of weekdays and hours they run in.
 *
 * Times are `"HH:MM"` strings on a 24-hour clock everywhere they cross a
 * boundary: lexical order is time order, a JSON Schema pattern describes
 * them, and a person writing YAML reads them without a lookup.
 *
 * Imports only `zod`: the browser and the server both load it.
 */

/** `"HH:MM"`, 24-hour, zero-padded: `"00:00"` to `"23:59"`. */
export type ScheduleTime = string;

export const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The minute steps a grid offers: each divides an hour, so the grid meets
 * every local hour at the same minutes. */
export const SCHEDULE_MINUTE_INTERVALS = [
  1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30,
] as const;
/** The hour steps a grid offers: each divides a day. */
export const SCHEDULE_HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12] as const;
/** The most times of day one day rule names. */
export const SCHEDULE_MAX_TIMES = 12;
/** The widest step of a day rule — the task picker's too. */
export const SCHEDULE_MAX_INTERVAL = 99;

export type MinuteInterval = (typeof SCHEDULE_MINUTE_INTERVALS)[number];
export type HourInterval = (typeof SCHEDULE_HOUR_INTERVALS)[number];

const MINUTES_PER_DAY = 24 * 60;

/** Days each month can have — February counts its leap day. */
const MAX_MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Where a grid runs. `weekdays` are `Date#getDay` numbers (0 is Sunday).
 * `hours` is a half-open `[from, to)` on the local wall clock; when `to` is
 * earlier than `from` it runs overnight, and the stretch after midnight
 * belongs to the day it started on. `to: "00:00"` runs until midnight.
 * Without `hours` the grid runs all day.
 */
export interface ScheduleWindow {
  weekdays: number[];
  hours?: { from: ScheduleTime; to: ScheduleTime };
}

export type ScheduleRule =
  | { frequency: 'minutely'; interval: MinuteInterval; window?: ScheduleWindow }
  | {
      frequency: 'hourly';
      interval: HourInterval;
      /** The minute past each hour, 0–59. */
      minute: number;
      window?: ScheduleWindow;
    }
  | { frequency: 'daily'; interval: number; times: ScheduleTime[] }
  | {
      frequency: 'weekly';
      interval: number;
      weekdays: number[];
      times: ScheduleTime[];
    }
  | {
      frequency: 'monthly';
      interval: number;
      /** Clamped to a shorter month's last day, never skipped. */
      monthDay: number;
      times: ScheduleTime[];
    }
  | {
      frequency: 'yearly';
      interval: number;
      /** 1 is January. */
      month: number;
      /** February 29 lands on the 28th in a common year. */
      monthDay: number;
      times: ScheduleTime[];
    };

/** The refusals a rule can earn, in the dotted form the trigger doors
 * answer under `data.issues[].code`. */
export const SCHEDULE_ISSUE_CODES = [
  'schedule.time_format',
  'schedule.times_required',
  'schedule.times_too_many',
  'schedule.interval_unsupported',
  'schedule.month_day_impossible',
  'schedule.window_hours_equal',
  'schedule.window_never_fires',
] as const;

export type ScheduleIssueCode = (typeof SCHEDULE_ISSUE_CODES)[number];

const MESSAGES: Record<ScheduleIssueCode, string> = {
  'schedule.time_format': 'Write times as HH:MM, for example 09:30.',
  'schedule.times_required': 'Add at least one time of day.',
  'schedule.times_too_many': `Use at most ${SCHEDULE_MAX_TIMES} times a day.`,
  'schedule.interval_unsupported': 'Pick one of the offered intervals.',
  'schedule.month_day_impossible': 'That month never has this day.',
  'schedule.window_hours_equal':
    'Start and end are the same. Leave out the hours to run all day.',
  'schedule.window_never_fires':
    'No start of this schedule falls between these hours.',
};

/** `"HH:MM"` as hour and minute, or null when it is not that shape. */
export function parseScheduleTime(
  text: ScheduleTime,
): { hour: number; minute: number } | null {
  if (!SCHEDULE_TIME_PATTERN.test(text)) return null;
  return { hour: Number(text.slice(0, 2)), minute: Number(text.slice(3, 5)) };
}

/** Hour and minute as `"HH:MM"`. */
export function formatScheduleTime(time: {
  hour: number;
  minute: number;
}): ScheduleTime {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

function minuteOfDay(text: ScheduleTime): number | null {
  const time = parseScheduleTime(text);
  return time === null ? null : time.hour * 60 + time.minute;
}

/** The step of a grid: every `interval` minutes, or every `interval` hours
 * at `minute` past. A grid rule is one; the cron reader builds others. */
export interface ScheduleGridStep {
  frequency: 'minutely' | 'hourly';
  interval: number;
  minute?: number;
}

/** The grid's first minute of the day at or after `minute` (0–1439), or
 * null when none is left that day. The grid is aligned to local midnight. */
export function gridMinuteAtOrAfter(
  rule: ScheduleGridStep,
  minute: number,
): number | null {
  const at = Math.max(0, minute);
  let found: number;
  if (rule.frequency === 'minutely') {
    found = Math.ceil(at / rule.interval) * rule.interval;
  } else {
    const past = rule.minute ?? 0;
    const step = rule.interval * 60;
    found = Math.max(0, Math.ceil((at - past) / step)) * step + past;
  }
  return found < MINUTES_PER_DAY ? found : null;
}

/** The grid's last minute of the day at or before `minute`, or null when
 * none comes that early. */
export function gridMinuteAtOrBefore(
  rule: ScheduleGridStep,
  minute: number,
): number | null {
  const at = Math.min(MINUTES_PER_DAY - 1, minute);
  if (at < 0) return null;
  if (rule.frequency === 'minutely') {
    return Math.floor(at / rule.interval) * rule.interval;
  }
  const past = rule.minute ?? 0;
  if (at < past) return null;
  const step = rule.interval * 60;
  return Math.floor((at - past) / step) * step + past;
}

/**
 * The stretches of one local day, as half-open minute ranges, that a
 * window's hours open: `[from, to)` on a same-day window; `[from, 24:00)`
 * on its start day and `[00:00, to)` on the day after for an overnight one.
 * `startDay` is whether the day itself is one of the window's weekdays,
 * `dayBefore` whether the day before it is. Without hours a listed day runs
 * whole.
 */
export function windowRangesOn(
  hours: ScheduleWindow['hours'],
  startDay: boolean,
  dayBefore: boolean,
): [number, number][] {
  if (hours === undefined) return startDay ? [[0, MINUTES_PER_DAY]] : [];
  const from = minuteOfDay(hours.from);
  const to = minuteOfDay(hours.to);
  if (from === null || to === null || from === to) return [];
  if (from < to) return startDay ? [[from, to]] : [];
  const ranges: [number, number][] = [];
  if (dayBefore && to > 0) ranges.push([0, to]);
  if (startDay) ranges.push([from, MINUTES_PER_DAY]);
  return ranges;
}

/** Whether some grid start falls inside the window's hours. */
function gridFiresIn(
  rule: ScheduleGridStep,
  hours: NonNullable<ScheduleWindow['hours']>,
): boolean {
  return windowRangesOn(hours, true, true).some(([from, to]) => {
    const first = gridMinuteAtOrAfter(rule, from);
    return first !== null && first < to;
  });
}

function issue(
  ctx: z.RefinementCtx,
  code: ScheduleIssueCode,
  path: (string | number)[],
): void {
  ctx.addIssue({
    code: 'custom',
    message: MESSAGES[code],
    path,
    params: { code },
  });
}

export const scheduleTimeSchema = z
  .string()
  .regex(SCHEDULE_TIME_PATTERN, MESSAGES['schedule.time_format'])
  .meta({ description: 'A time of day, "HH:MM" on a 24-hour clock.' });

const weekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7)
  .meta({
    description: 'Days of the week, 0 (Sunday) to 6 (Saturday).',
  });

export const scheduleWindowSchema = z
  .strictObject({
    weekdays: weekdaysSchema,
    hours: z
      .strictObject({ from: scheduleTimeSchema, to: scheduleTimeSchema })
      .optional()
      .meta({
        description:
          'Run only from `from` until before `to`, local time. A `to` earlier than `from` runs overnight into the next day; "00:00" runs until midnight. Omit to run all day.',
      }),
  })
  .superRefine((window, ctx) => {
    if (window.hours !== undefined && window.hours.from === window.hours.to) {
      issue(ctx, 'schedule.window_hours_equal', ['hours']);
    }
  })
  .meta({ description: 'The weekdays and hours a grid schedule runs in.' });

const timesSchema = z
  .array(scheduleTimeSchema)
  .min(1, MESSAGES['schedule.times_required'])
  .max(SCHEDULE_MAX_TIMES, MESSAGES['schedule.times_too_many'])
  .meta({ description: 'The times of day it starts at, 1 to 12.' });

const dayIntervalSchema = z
  .number()
  .int(MESSAGES['schedule.interval_unsupported'])
  .min(1, MESSAGES['schedule.interval_unsupported'])
  .max(SCHEDULE_MAX_INTERVAL, MESSAGES['schedule.interval_unsupported'])
  .meta({ description: 'Every how many days, weeks, months or years.' });

const monthDaySchema = z.number().int().min(1).max(31).meta({
  description:
    "The day of the month, 1 to 31; a shorter month's last day stands in for a day it lacks.",
});

function neverFires(
  rule: {
    frequency: 'minutely' | 'hourly';
    interval: number;
    minute?: number;
    window?: ScheduleWindow;
  },
  ctx: z.RefinementCtx,
): void {
  const hours = rule.window?.hours;
  if (hours === undefined || hours.from === hours.to) return;
  if (minuteOfDay(hours.from) === null || minuteOfDay(hours.to) === null)
    return;
  const interval = rule.interval;
  const valid =
    rule.frequency === 'minutely'
      ? (SCHEDULE_MINUTE_INTERVALS as readonly number[]).includes(interval)
      : (SCHEDULE_HOUR_INTERVALS as readonly number[]).includes(interval);
  if (!valid) return;
  if (
    !gridFiresIn(
      { frequency: rule.frequency, interval, minute: rule.minute },
      hours,
    )
  ) {
    issue(ctx, 'schedule.window_never_fires', ['window', 'hours']);
  }
}

const minutelySchema = z
  .strictObject({
    frequency: z.literal('minutely'),
    interval: z
      .literal(SCHEDULE_MINUTE_INTERVALS, {
        error: MESSAGES['schedule.interval_unsupported'],
      })
      .meta({ description: 'Every how many minutes; divides 60.' }),
    window: scheduleWindowSchema.optional(),
  })
  .superRefine(neverFires);

const hourlySchema = z
  .strictObject({
    frequency: z.literal('hourly'),
    interval: z
      .literal(SCHEDULE_HOUR_INTERVALS, {
        error: MESSAGES['schedule.interval_unsupported'],
      })
      .meta({ description: 'Every how many hours; divides 24.' }),
    minute: z
      .number()
      .int()
      .min(0)
      .max(59)
      .meta({ description: 'The minute past the hour it starts at.' }),
    window: scheduleWindowSchema.optional(),
  })
  .superRefine(neverFires);

const dailySchema = z.strictObject({
  frequency: z.literal('daily'),
  interval: dayIntervalSchema,
  times: timesSchema,
});

const weeklySchema = z.strictObject({
  frequency: z.literal('weekly'),
  interval: dayIntervalSchema,
  weekdays: weekdaysSchema,
  times: timesSchema,
});

const monthlySchema = z.strictObject({
  frequency: z.literal('monthly'),
  interval: dayIntervalSchema,
  monthDay: monthDaySchema,
  times: timesSchema,
});

const yearlySchema = z
  .strictObject({
    frequency: z.literal('yearly'),
    interval: dayIntervalSchema,
    month: z
      .number()
      .int()
      .min(1)
      .max(12)
      .meta({ description: 'The month, 1 (January) to 12.' }),
    monthDay: monthDaySchema,
    times: timesSchema,
  })
  .superRefine((rule, ctx) => {
    const most = MAX_MONTH_DAYS[rule.month - 1];
    if (most !== undefined && rule.monthDay > most) {
      issue(ctx, 'schedule.month_day_impossible', ['monthDay']);
    }
  });

export const scheduleRuleSchema = z
  .discriminatedUnion('frequency', [
    minutelySchema,
    hourlySchema,
    dailySchema,
    weeklySchema,
    monthlySchema,
    yearlySchema,
  ])
  .meta({
    description:
      'When a schedule starts: every N minutes or hours (optionally only on some weekdays and hours), or at times of day on a daily, weekly, monthly or yearly rule.',
  });

function isScheduleIssueCode(value: unknown): value is ScheduleIssueCode {
  return (SCHEDULE_ISSUE_CODES as readonly unknown[]).includes(value);
}

/**
 * The schedule code a refusal of {@link scheduleRuleSchema} carries, or null
 * for a problem of shape (a missing key, a wrong type, an unknown
 * frequency), which keeps zod's own code. Paths may sit under a parent
 * (`repeat.times`); only their last key is read.
 */
export function scheduleIssueCode(
  found: z.core.$ZodIssue,
): ScheduleIssueCode | null {
  if (found.code === 'custom') {
    const code: unknown = found.params?.code;
    return isScheduleIssueCode(code) ? code : null;
  }
  if (
    found.code === 'invalid_format' &&
    found.format === 'regex' &&
    found.pattern === String(SCHEDULE_TIME_PATTERN)
  ) {
    return 'schedule.time_format';
  }
  const last = found.path.at(-1);
  if (last === 'times' && found.code === 'too_small') {
    return 'schedule.times_required';
  }
  if (last === 'times' && found.code === 'too_big') {
    return 'schedule.times_too_many';
  }
  if (
    last === 'interval' &&
    (found.code === 'invalid_value' ||
      found.code === 'too_small' ||
      found.code === 'too_big')
  ) {
    return 'schedule.interval_unsupported';
  }
  if (
    last === 'interval' &&
    found.code === 'invalid_type' &&
    found.expected === 'int'
  ) {
    return 'schedule.interval_unsupported';
  }
  return null;
}

const sortedUnique = (values: readonly number[]) =>
  [...new Set(values)].toSorted((a, b) => a - b);
const sortedTimes = (values: readonly ScheduleTime[]) =>
  [...new Set(values)].toSorted();

function normalizeWindow(
  window: ScheduleWindow | undefined,
): ScheduleWindow | undefined {
  if (window === undefined) return undefined;
  const weekdays = sortedUnique(window.weekdays);
  const hours =
    window.hours !== undefined && window.hours.from !== window.hours.to
      ? { from: window.hours.from, to: window.hours.to }
      : undefined;
  if (hours === undefined) {
    return weekdays.length === 7 ? undefined : { weekdays };
  }
  return { weekdays, hours };
}

/**
 * One spelling per meaning, so two rules that say the same compare equal
 * and a stored rule reads back the way it was meant: only the keys its
 * frequency has, times and weekdays sorted without repeats, hours with the
 * same start and end dropped (all day), and a window with every weekday and
 * no hours dropped (it limits nothing).
 */
export function normalizeScheduleRule(rule: ScheduleRule): ScheduleRule {
  switch (rule.frequency) {
    case 'minutely': {
      const window = normalizeWindow(rule.window);
      return {
        frequency: 'minutely',
        interval: rule.interval,
        ...(window !== undefined ? { window } : {}),
      };
    }
    case 'hourly': {
      const window = normalizeWindow(rule.window);
      return {
        frequency: 'hourly',
        interval: rule.interval,
        minute: rule.minute,
        ...(window !== undefined ? { window } : {}),
      };
    }
    case 'daily':
      return {
        frequency: 'daily',
        interval: rule.interval,
        times: sortedTimes(rule.times),
      };
    case 'weekly':
      return {
        frequency: 'weekly',
        interval: rule.interval,
        weekdays: sortedUnique(rule.weekdays),
        times: sortedTimes(rule.times),
      };
    case 'monthly':
      return {
        frequency: 'monthly',
        interval: rule.interval,
        monthDay: rule.monthDay,
        times: sortedTimes(rule.times),
      };
    case 'yearly':
      return {
        frequency: 'yearly',
        interval: rule.interval,
        month: rule.month,
        monthDay: rule.monthDay,
        times: sortedTimes(rule.times),
      };
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}

/** Whether two rules say the same, however each was spelled. */
export function sameScheduleRule(
  a?: ScheduleRule | null,
  b?: ScheduleRule | null,
): boolean {
  if (!a || !b) return !a && !b;
  return (
    JSON.stringify(normalizeScheduleRule(a)) ===
    JSON.stringify(normalizeScheduleRule(b))
  );
}
