/**
 * When something starts — a schedule's repeat rule — as the recurrence
 * picker's time mode reads and writes it.
 *
 * A schedule rule is a repeat rule plus times of day: the day frequencies
 * are exactly `RecurrenceRule` with `times` added, so stripping `times`
 * leaves a rule the day picker reads with the same words. `minutely` and
 * `hourly` are grids on the local wall clock, aligned to midnight, with an
 * optional window of weekdays and hours they run in.
 *
 * Times are `"HH:MM"` strings on a 24-hour clock wherever a rule crosses a
 * boundary (the picker's `value` and `onChange`, a host's storage); the
 * editor's draft holds `TimeOfDay` objects. This is the design system's
 * copy of the platform's schedule rule (`@tale/shared/schemas/schedule-rule`):
 * the package cannot import it, so the platform's parity test holds the two
 * together. Pure and zone free, like the day rules: the host computes every
 * instant a rule produces.
 */

import { clampTime, sameTime, type TimeOfDay } from '../time-of-day';
import {
  RECURRENCE_MAX_INTERVAL,
  RECURRENCE_WORKWEEK,
  type RecurrenceDraft,
  recurrenceDraft,
  type RecurrenceFrequency,
  recurrenceFromDraft,
  type RecurrenceReference,
  type RecurrenceRule,
} from './rule';

/** `"HH:MM"`, 24-hour, zero-padded: `"00:00"` to `"23:59"`. */
export type ScheduleTime = string;

export const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The minute steps a grid offers: each divides an hour. */
export const SCHEDULE_MINUTE_INTERVALS = [
  1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30,
] as const;
/** The hour steps a grid offers: each divides a day. */
export const SCHEDULE_HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12] as const;
/** The most times of day one day rule names. */
export const SCHEDULE_MAX_TIMES = 12;
/** The widest step of a day rule — the day picker's too. */
export const SCHEDULE_MAX_INTERVAL = RECURRENCE_MAX_INTERVAL;

export type MinuteInterval = (typeof SCHEDULE_MINUTE_INTERVALS)[number];
export type HourInterval = (typeof SCHEDULE_HOUR_INTERVALS)[number];
export type ScheduleFrequency = 'minutely' | 'hourly' | RecurrenceFrequency;

/**
 * Where a grid runs. `weekdays` are `Date#getDay` numbers; all seven is no
 * day limit. `hours` is a half-open `[from, to)` on the local wall clock;
 * a `to` earlier than `from` runs overnight, and the stretch after midnight
 * belongs to the day it started on. `to: "00:00"` runs until midnight.
 * Without `hours` the grid runs all day.
 */
export interface ScheduleWindow {
  weekdays: number[];
  hours?: { from: ScheduleTime; to: ScheduleTime };
}

/** A grid: every N minutes, or every N hours at a minute past. */
export type ScheduleGridRule =
  | { frequency: 'minutely'; interval: MinuteInterval; window?: ScheduleWindow }
  | {
      frequency: 'hourly';
      interval: HourInterval;
      /** The minute past each hour, 0–59. */
      minute: number;
      window?: ScheduleWindow;
    };

/** A repeat rule at times of day: 1 to 12 times, sorted, no repeats. */
export type ScheduleDayRule = RecurrenceRule & { times: ScheduleTime[] };

export type ScheduleRule = ScheduleGridRule | ScheduleDayRule;

/** The one-click choices, in the order the picker lists them. */
export const SCHEDULE_PRESETS = [
  'every15Minutes',
  'hourly',
  'daily',
  'weekdays',
  'weekly',
  'monthly',
] as const;

export type SchedulePreset = (typeof SCHEDULE_PRESETS)[number];

/**
 * The day the presets and a new custom rule are read off (today in the
 * schedule's zone, worked out by the host), plus the time of day the day
 * presets start at. @default time "09:00"
 */
export interface ScheduleReference extends RecurrenceReference {
  time?: ScheduleTime;
}

/** One upcoming start, as the host computed it. */
export interface ScheduleOccurrence {
  /** Epoch milliseconds. */
  at: number;
  /** The zone the schedule runs in, which the start is written in. */
  timeZone: string;
  /** How the start met a clock change, when it did. */
  clockChange?:
    | {
        /** `wallTime` did not exist that day; `at` is the shifted start. */
        kind: 'shiftedForward';
        wallTime: ScheduleTime;
      }
    | {
        /** The hour repeats that day. `interval` is true for a grid, which
         *  keeps its real-time spacing through it; a time of day runs at
         *  the first one only. */
        kind: 'repeatedHour';
        interval: boolean;
      };
}

/** The time a day preset starts at when the host names none. */
export const SCHEDULE_DEFAULT_TIME: ScheduleTime = '09:00';

/** The hours "Only between" starts with. */
const DEFAULT_WINDOW_HOURS = {
  from: { hour: 8, minute: 0 },
  to: { hour: 18, minute: 0 },
};

const ALL_WEEKDAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
const MINUTES_PER_DAY = 24 * 60;

/** `"HH:MM"` as hour and minute, or null when it is not that shape. */
export function parseScheduleTime(text: ScheduleTime): TimeOfDay | null {
  if (!SCHEDULE_TIME_PATTERN.test(text)) return null;
  return { hour: Number(text.slice(0, 2)), minute: Number(text.slice(3, 5)) };
}

/** Hour and minute as `"HH:MM"`. */
export function formatScheduleTime(time: TimeOfDay): ScheduleTime {
  const { hour, minute } = clampTime(time);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Whether the rule is a grid rather than a rule at times of day. */
export function isScheduleGrid(rule: ScheduleRule): rule is ScheduleGridRule {
  return rule.frequency === 'minutely' || rule.frequency === 'hourly';
}

/** Interval rules run on a grid; times rules at times of day. */
export function scheduleKind(rule: ScheduleRule): 'interval' | 'times' {
  return isScheduleGrid(rule) ? 'interval' : 'times';
}

/** The days a times rule runs on — the rule without its times. */
export function scheduleDays(rule: ScheduleDayRule): RecurrenceRule {
  switch (rule.frequency) {
    case 'daily':
      return { frequency: 'daily', interval: rule.interval };
    case 'weekly':
      return {
        frequency: 'weekly',
        interval: rule.interval,
        weekdays: [...rule.weekdays],
      };
    case 'monthly':
      return {
        frequency: 'monthly',
        interval: rule.interval,
        monthDay: rule.monthDay,
      };
    case 'yearly':
      return {
        frequency: 'yearly',
        interval: rule.interval,
        month: rule.month,
        monthDay: rule.monthDay,
      };
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}

/** The earliest time of a times rule; a grid names none. */
export function firstTime(rule: ScheduleRule): ScheduleTime | undefined {
  if (isScheduleGrid(rule)) return undefined;
  return sortedTimes(rule.times)[0];
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
 * One spelling per meaning — the form a host stores and compares: only the
 * keys its frequency has, times and weekdays sorted without repeats, hours
 * with the same start and end dropped (all day), and a window with every
 * weekday and no hours dropped (it limits nothing).
 */
export function normalizeSchedule(rule: ScheduleRule): ScheduleRule {
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

/** Whether two rules say the same, however each was spelled. Keys a host
 *  adds take no part. */
export function sameSchedule(
  a?: ScheduleRule | null,
  b?: ScheduleRule | null,
): boolean {
  if (!a || !b) return !a && !b;
  return (
    JSON.stringify(normalizeSchedule(a)) ===
    JSON.stringify(normalizeSchedule(b))
  );
}

/** The rule a preset means, read off `reference`. */
export function schedulePreset(
  preset: SchedulePreset,
  reference: ScheduleReference,
): ScheduleRule {
  const times = [reference.time ?? SCHEDULE_DEFAULT_TIME];
  switch (preset) {
    case 'every15Minutes':
      return { frequency: 'minutely', interval: 15 };
    case 'hourly':
      return { frequency: 'hourly', interval: 1, minute: 0 };
    case 'daily':
      return { frequency: 'daily', interval: 1, times };
    case 'weekdays':
      return {
        frequency: 'weekly',
        interval: 1,
        weekdays: [...RECURRENCE_WORKWEEK],
        times,
      };
    case 'weekly':
      return {
        frequency: 'weekly',
        interval: 1,
        weekdays: [reference.weekday],
        times,
      };
    case 'monthly':
      return {
        frequency: 'monthly',
        interval: 1,
        monthDay: reference.day,
        times,
      };
    default: {
      const exhaustive: never = preset;
      return exhaustive;
    }
  }
}

/** The preset a rule is, read off `reference`, or null for a custom rule. */
export function matchSchedulePreset(
  rule: ScheduleRule,
  reference: ScheduleReference,
  presets: readonly SchedulePreset[] = SCHEDULE_PRESETS,
): SchedulePreset | null {
  return (
    presets.find((preset) =>
      sameSchedule(schedulePreset(preset, reference), rule),
    ) ?? null
  );
}

function minuteOf(time: TimeOfDay): number {
  return time.hour * 60 + time.minute;
}

function timeAt(minute: number): TimeOfDay {
  return { hour: Math.floor(minute / 60), minute: minute % 60 };
}

/** The grid's first start of the day at or after `minute`, or null. The grid
 *  is aligned to local midnight — the wall clock the host evaluates. */
function gridAtOrAfter(rule: ScheduleGridRule, minute: number): number | null {
  const at = Math.max(0, minute);
  let found: number;
  if (rule.frequency === 'minutely') {
    found = Math.ceil(at / rule.interval) * rule.interval;
  } else {
    const step = rule.interval * 60;
    found =
      Math.max(0, Math.ceil((at - rule.minute) / step)) * step + rule.minute;
  }
  return found < MINUTES_PER_DAY ? found : null;
}

/** The grid's last start of the day at or before `minute`, or null. */
function gridAtOrBefore(rule: ScheduleGridRule, minute: number): number | null {
  const at = Math.min(MINUTES_PER_DAY - 1, minute);
  if (at < 0) return null;
  if (rule.frequency === 'minutely') {
    return Math.floor(at / rule.interval) * rule.interval;
  }
  if (at < rule.minute) return null;
  const step = rule.interval * 60;
  return Math.floor((at - rule.minute) / step) * step + rule.minute;
}

/** The first and last start inside the half-open `[from, to)`, or null. */
function startsIn(
  rule: ScheduleGridRule,
  from: number,
  to: number,
): { first: number; last: number } | null {
  if (to <= from) return null;
  const first = gridAtOrAfter(rule, from);
  const last = gridAtOrBefore(rule, to - 1);
  if (first === null || last === null || first >= to || last < first) {
    return null;
  }
  return { first, last };
}

/** Where a day's starts fall: all on the window's own day, on both sides
 * of midnight, or all after midnight, on the next day. */
export type WindowSpan = 'sameDay' | 'overnight' | 'nextMorning';

/**
 * A grid's first and last start in a day of its window, as the editor's
 * hint says them, or null when no start falls inside the hours (the rule
 * would never run). `span` says where they fall: a window "18:00 until
 * 00:00" ends the same day, "22:00 until 06:00" every 30 minutes runs
 * overnight, and "21:00 until 03:00" every 4 hours starts only at 00:00,
 * the next morning. One start makes `first` and `last` the same time. A
 * rule without hours, or with the same start and end, runs all day.
 */
export function windowStarts(
  rule: ScheduleGridRule,
): { first: TimeOfDay; last: TimeOfDay; span: WindowSpan } | null {
  const hours = rule.window?.hours;
  const from = hours ? parseScheduleTime(hours.from) : null;
  const to = hours ? parseScheduleTime(hours.to) : null;
  const read = (
    day: { first: number; last: number } | null,
    span: WindowSpan,
  ) =>
    day === null
      ? null
      : { first: timeAt(day.first), last: timeAt(day.last), span };
  if (from === null || to === null || sameTime(from, to)) {
    return read(startsIn(rule, 0, MINUTES_PER_DAY), 'sameDay');
  }
  const start = minuteOf(from);
  const end = minuteOf(to);
  if (start < end) return read(startsIn(rule, start, end), 'sameDay');
  const evening = startsIn(rule, start, MINUTES_PER_DAY);
  const morning = startsIn(rule, 0, end);
  if (evening === null) return read(morning, 'nextMorning');
  if (morning === null) return read(evening, 'sameDay');
  return read({ first: evening.first, last: morning.last }, 'overnight');
}

/**
 * The editor's state for a schedule. Both custom views keep their own part,
 * so switching between Custom interval and Custom times — or between minutes
 * and hours — loses nothing. Every field is always in range.
 */
export interface ScheduleDraft {
  /** The days of a times rule, edited by the day picker's own editor. */
  calendar: RecurrenceDraft;
  /** In the author's order, repeats allowed; the rule sorts them. */
  times: TimeOfDay[];
  /** The grid's unit, and the last step picked in each unit. */
  every: {
    unit: 'minutely' | 'hourly';
    minutes: MinuteInterval;
    hours: HourInterval;
  };
  /** The minute past the hour an hourly grid starts at, 0–59. */
  minutePast: number;
  /** The window's weekdays, at least one; all seven is no day limit. */
  windowDays: number[];
  /** The window's hours, or null to run all day. */
  windowHours: { from: TimeOfDay; to: TimeOfDay } | null;
  /** The hours "Only between" brings back when it is checked again. */
  lastWindowHours: { from: TimeOfDay; to: TimeOfDay };
}

function windowHoursOf(
  window: ScheduleWindow | undefined,
): { from: TimeOfDay; to: TimeOfDay } | null {
  if (window?.hours === undefined) return null;
  const from = parseScheduleTime(window.hours.from);
  const to = parseScheduleTime(window.hours.to);
  return from !== null && to !== null ? { from, to } : null;
}

/**
 * A draft from a rule, or — with no rule — daily at the reference's time.
 * The parts the rule does not use start from the reference and the
 * defaults: daily at 09:00, every 15 minutes, every hour on the hour, every
 * day, 08:00 to 18:00.
 */
export function scheduleDraft(
  rule: ScheduleRule | null,
  reference: ScheduleReference,
  maxInterval: number = SCHEDULE_MAX_INTERVAL,
): ScheduleDraft {
  const time =
    parseScheduleTime(reference.time ?? SCHEDULE_DEFAULT_TIME) ??
    timeAt(9 * 60);
  const base: ScheduleDraft = {
    calendar: recurrenceDraft(
      { frequency: 'daily', interval: 1 },
      reference,
      maxInterval,
    ),
    times: [time],
    every: { unit: 'minutely', minutes: 15, hours: 1 },
    minutePast: 0,
    windowDays: [...ALL_WEEKDAYS],
    windowHours: null,
    lastWindowHours: DEFAULT_WINDOW_HOURS,
  };
  if (rule === null) return base;
  if (isScheduleGrid(rule)) {
    const windowHours = windowHoursOf(rule.window);
    const days = rule.window?.weekdays.filter((day) =>
      ALL_WEEKDAYS.includes(day),
    );
    return {
      ...base,
      every:
        rule.frequency === 'minutely'
          ? { ...base.every, unit: 'minutely', minutes: rule.interval }
          : { ...base.every, unit: 'hourly', hours: rule.interval },
      minutePast:
        rule.frequency === 'hourly'
          ? Math.min(59, Math.max(0, Math.trunc(rule.minute)))
          : 0,
      windowDays:
        days !== undefined && days.length > 0
          ? sortedUnique(days)
          : base.windowDays,
      windowHours,
      lastWindowHours: windowHours ?? base.lastWindowHours,
    };
  }
  const times = rule.times
    .map(parseScheduleTime)
    .filter((parsed): parsed is TimeOfDay => parsed !== null);
  return {
    ...base,
    calendar: recurrenceDraft(scheduleDays(rule), reference, maxInterval),
    times: times.length > 0 ? times : base.times,
  };
}

/** The rule a draft means in one of the two custom views, normalized. */
export function scheduleFromDraft(
  draft: ScheduleDraft,
  kind: 'interval' | 'times',
): ScheduleRule {
  if (kind === 'times') {
    return normalizeSchedule({
      ...recurrenceFromDraft(draft.calendar),
      times: draft.times.map(formatScheduleTime),
    });
  }
  const window: ScheduleWindow = {
    weekdays:
      draft.windowDays.length > 0 ? draft.windowDays : [...ALL_WEEKDAYS],
    ...(draft.windowHours !== null
      ? {
          hours: {
            from: formatScheduleTime(draft.windowHours.from),
            to: formatScheduleTime(draft.windowHours.to),
          },
        }
      : {}),
  };
  return normalizeSchedule(
    draft.every.unit === 'minutely'
      ? { frequency: 'minutely', interval: draft.every.minutes, window }
      : {
          frequency: 'hourly',
          interval: draft.every.hours,
          minute: Math.min(59, Math.max(0, Math.trunc(draft.minutePast))),
          window,
        },
  );
}

/**
 * The time a new row starts at: an hour after the last row while that stays
 * within the day and is not taken, else the first full hour from midnight
 * no row holds.
 */
export function nextFreeTime(times: readonly TimeOfDay[]): TimeOfDay {
  const taken = (minute: number) =>
    times.some((time) => minuteOf(time) === minute);
  const last = times.at(-1);
  if (last !== undefined) {
    const after = minuteOf(clampTime(last)) + 60;
    if (after < MINUTES_PER_DAY && !taken(after)) return timeAt(after);
  }
  for (let hour = 0; hour < 24; hour += 1) {
    if (!taken(hour * 60)) return { hour, minute: 0 };
  }
  return last === undefined ? timeAt(9 * 60) : clampTime(last);
}
