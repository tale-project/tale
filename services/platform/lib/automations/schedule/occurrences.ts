/**
 * When a schedule trigger starts: the one evaluator behind the scan that
 * fires a schedule, the save that computes its next run, and the editor's
 * "next runs" preview, so the times a person is shown are the times the
 * platform keeps.
 *
 * A schedule is a repeat rule or a cron expression, in an IANA zone, and it
 * falls in one of two daylight-saving classes, shared by both:
 *
 * - **Named times** — a day rule's `times`, and a cron expression whose
 *   minute and hour are both spelled out. Each names a time of day once a
 *   day. A time the clock skips moves forward by the gap; a time the clock
 *   repeats starts once, at its first instant; two times that land on one
 *   instant start once.
 * - **Grids** — `minutely` and `hourly` rules, and a cron expression whose
 *   minute or hour starts with `*`. They start at every instant whose local
 *   wall clock is on the grid, aligned to local midnight, so they keep their
 *   pace in real time: a repeated hour runs twice, a skipped one not at all.
 *
 * Day rules step through the same calendar days a repeating task does
 * (`lib/shared/calendar.ts`): a rule's phase is set by its first matching
 * day on or after its start date, and every Nth period follows. Grids ignore
 * the phase; the start date only gates when they begin.
 *
 * Pure: no clock is read; every walk takes the instant it starts from.
 */

import {
  formatScheduleTime,
  gridMinuteAtOrAfter,
  gridMinuteAtOrBefore,
  normalizeScheduleRule,
  parseScheduleTime,
  type ScheduleGridStep,
  type ScheduleRule,
  scheduleRuleSchema,
  type ScheduleTime,
  windowRangesOn,
} from '@tale/shared/schemas/schedule-rule';
import { z } from 'zod';

import {
  addDays,
  type CalendarDate,
  clampedDate,
  compareDates,
  daysBetween,
  firstRuleDay,
  isoIndex,
  mondayOf,
  monthsBetween,
  parseIsoDate,
  weekdayOf,
} from '../../shared/calendar.ts';
import {
  canonicalTimeZone,
  type ClockTime,
  localDateIn,
  offsetAt,
  wallClockIn,
  zonedCandidates,
  zonedInstant,
} from '../../shared/zoned-time.ts';
import { type CronSchedule, cronDstClass, parseCron } from '../cron.ts';

const MINUTE_MS = 60_000;
const MIDNIGHT: ClockTime = { hour: 0, minute: 0 };

/** A schedule starts at most this late after its occurrence when it may
 * only start on time (`catchUp: 'skip'`): enough for a redeploy. */
export const SCHEDULE_ON_TIME_GRACE_MS = 10 * MINUTE_MS;

/** The most missed occurrences one decision counts; past it the count is
 * reported as capped. */
export const MISSED_COUNT_CAP = 1000;

/** How far a cron expression's day fields are searched: `0 0 29 2 *` can
 * wait eight years (2096 to 2104). */
const CRON_HORIZON_DAYS = 8 * 366 + 1;

/** A bound on one grid walk's steps — far more than any schedule the
 * schema accepts needs, so a rule written around it cannot spin. */
const GRID_STEPS = 2000;

/** A bound on one named walk's days: the answer is never more than three
 * matching days away from the day it starts on. */
const NAMED_STEPS = 8;

export type CronDstClass = 'grid' | 'named';

export type Schedule =
  | {
      type: 'rule';
      rule: ScheduleRule;
      timezone: string;
      /** No occurrence falls before its midnight; a day rule's phase starts
       * at its first matching day on or after it. */
      startDate: CalendarDate;
    }
  | {
      type: 'cron';
      cron: CronSchedule;
      timezone: string;
      dstClass: CronDstClass;
    };

/** How an occurrence met a clock change, for the preview to say so. */
export type ScheduleClockChange =
  | {
      /** The named time did not exist that day; `at` is the shifted
       * instant. */
      kind: 'shiftedForward';
      wallTime: ScheduleTime;
    }
  | {
      /** Its local time occurs twice that day. `interval` is true for a
       * grid, which runs at both; a named time runs at the first only. */
      kind: 'repeatedHour';
      interval: boolean;
    };

/** One upcoming start, as the editor's preview lists it. */
export interface ScheduleOccurrenceData {
  at: number;
  timeZone: string;
  clockChange?: ScheduleClockChange;
}

/** The days a schedule can start on. */
interface DayWalk {
  /** The first such day at or after `date`, or null past the horizon. */
  atOrAfter(date: CalendarDate): CalendarDate | null;
  /** The last such day at or before `date`, or null before the first. */
  atOrBefore(date: CalendarDate): CalendarDate | null;
}

interface NamedPlan extends DayWalk {
  kind: 'named';
  zone: string;
  times: ClockTime[];
}

interface GridPlan extends DayWalk {
  kind: 'grid';
  zone: string;
  /** No start comes before this instant. */
  notBefore: number;
  /** The first start minute (0–1439) at or after `minute` on `date`. */
  minuteAtOrAfter(date: CalendarDate, minute: number): number | null;
  /** The last start minute at or before `minute` on `date`. */
  minuteAtOrBefore(date: CalendarDate, minute: number): number | null;
}

type Plan = NamedPlan | GridPlan;

interface Found {
  at: number;
  clockChange?: ScheduleClockChange;
}

// ---------------------------------------------------------------------------
// Day rules
// ---------------------------------------------------------------------------

type DayRule = Extract<
  ScheduleRule,
  { frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' }
>;

/** Monday-first indexes of a weekly rule's days, ascending. */
function isoDays(weekdays: readonly number[]): number[] {
  return [...new Set(weekdays.map(isoIndex))].toSorted((a, b) => a - b);
}

/** The rule's first day at or after `date`, for a `date` after `anchor`
 * (its first day): jumps by periods, never day by day. */
function ruleDayAtOrAfter(
  rule: DayRule,
  anchor: CalendarDate,
  date: CalendarDate,
): CalendarDate {
  const n = rule.interval;
  switch (rule.frequency) {
    case 'daily':
      return addDays(anchor, Math.ceil(daysBetween(anchor, date) / n) * n);
    case 'weekly': {
      const days = isoDays(rule.weekdays);
      const base = mondayOf(anchor);
      const weeks = daysBetween(base, mondayOf(date)) / 7;
      if (weeks % n === 0) {
        const today = isoIndex(weekdayOf(date));
        const later = days.find((day) => day >= today);
        if (later !== undefined) return addDays(mondayOf(date), later);
      }
      const week = (Math.floor(weeks / n) + 1) * n;
      return addDays(base, week * 7 + (days[0] ?? 0));
    }
    case 'monthly': {
      const k = Math.ceil(monthsBetween(anchor, date) / n) * n;
      const day = clampedDate(anchor.year, anchor.month + k, rule.monthDay);
      return compareDates(day, date) >= 0
        ? day
        : clampedDate(anchor.year, anchor.month + k + n, rule.monthDay);
    }
    case 'yearly': {
      const k = Math.ceil((date.year - anchor.year) / n) * n;
      const day = clampedDate(anchor.year + k, rule.month, rule.monthDay);
      return compareDates(day, date) >= 0
        ? day
        : clampedDate(anchor.year + k + n, rule.month, rule.monthDay);
    }
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}

/** The rule's last day at or before `date`, for a `date` not before
 * `anchor`. */
function ruleDayAtOrBefore(
  rule: DayRule,
  anchor: CalendarDate,
  date: CalendarDate,
): CalendarDate | null {
  const n = rule.interval;
  switch (rule.frequency) {
    case 'daily':
      return addDays(anchor, Math.floor(daysBetween(anchor, date) / n) * n);
    case 'weekly': {
      const days = isoDays(rule.weekdays);
      const base = mondayOf(anchor);
      const weeks = daysBetween(base, mondayOf(date)) / 7;
      if (weeks % n === 0) {
        const today = isoIndex(weekdayOf(date));
        const earlier = days.findLast((day) => day <= today);
        if (earlier !== undefined) {
          const day = addDays(mondayOf(date), earlier);
          if (compareDates(day, anchor) >= 0) return day;
        }
      }
      const week = weeks % n === 0 ? weeks - n : Math.floor(weeks / n) * n;
      if (week < 0) return null;
      const day = addDays(base, week * 7 + (days.at(-1) ?? 0));
      return compareDates(day, anchor) >= 0 ? day : null;
    }
    case 'monthly': {
      let k = Math.floor(monthsBetween(anchor, date) / n) * n;
      if (
        compareDates(
          clampedDate(anchor.year, anchor.month + k, rule.monthDay),
          date,
        ) > 0
      ) {
        k -= n;
      }
      return k < 0
        ? null
        : clampedDate(anchor.year, anchor.month + k, rule.monthDay);
    }
    case 'yearly': {
      let k = Math.floor((date.year - anchor.year) / n) * n;
      if (
        compareDates(
          clampedDate(anchor.year + k, rule.month, rule.monthDay),
          date,
        ) > 0
      ) {
        k -= n;
      }
      return k < 0
        ? null
        : clampedDate(anchor.year + k, rule.month, rule.monthDay);
    }
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}

function ruleDays(rule: DayRule, startDate: CalendarDate): DayWalk {
  const anchor = firstRuleDay(rule, startDate);
  return {
    atOrAfter: (date) =>
      compareDates(date, anchor) <= 0
        ? anchor
        : ruleDayAtOrAfter(rule, anchor, date),
    atOrBefore: (date) =>
      compareDates(date, anchor) < 0
        ? null
        : ruleDayAtOrBefore(rule, anchor, date),
  };
}

function clockTimes(times: readonly ScheduleTime[]): ClockTime[] {
  const parsed: ClockTime[] = [];
  for (const text of [...new Set(times)].toSorted()) {
    const time = parseScheduleTime(text);
    if (time !== null) parsed.push(time);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Grid rules
// ---------------------------------------------------------------------------

type GridRule = Extract<ScheduleRule, { frequency: 'minutely' | 'hourly' }>;

const WHOLE_DAY: [number, number][] = [[0, 24 * 60]];

function gridPlan(
  rule: GridRule,
  zone: string,
  startDate: CalendarDate,
): GridPlan {
  const step: ScheduleGridStep =
    rule.frequency === 'hourly'
      ? { frequency: 'hourly', interval: rule.interval, minute: rule.minute }
      : { frequency: 'minutely', interval: rule.interval };
  const window = rule.window;
  const weekdays = window === undefined ? null : new Set(window.weekdays);
  const ranges = (date: CalendarDate): [number, number][] =>
    weekdays === null
      ? WHOLE_DAY
      : windowRangesOn(
          window?.hours,
          weekdays.has(weekdayOf(date)),
          weekdays.has(weekdayOf(addDays(date, -1))),
        );
  const open = (date: CalendarDate) => ranges(date).length > 0;
  return {
    kind: 'grid',
    zone,
    notBefore: zonedInstant(startDate, MIDNIGHT, zone),
    atOrAfter: (date) => {
      for (let i = 0; i < 8; i += 1) {
        const day = addDays(date, i);
        if (open(day)) return day;
      }
      return null;
    },
    atOrBefore: (date) => {
      for (let i = 0; i < 8; i += 1) {
        const day = addDays(date, -i);
        if (open(day)) return day;
      }
      return null;
    },
    minuteAtOrAfter: (date, minute) => {
      for (const [from, to] of ranges(date)) {
        if (minute >= to) continue;
        const found = gridMinuteAtOrAfter(step, Math.max(minute, from));
        if (found !== null && found < to) return found;
      }
      return null;
    },
    minuteAtOrBefore: (date, minute) => {
      for (const [from, to] of ranges(date).toReversed()) {
        if (minute < from) continue;
        const found = gridMinuteAtOrBefore(step, Math.min(minute, to - 1));
        if (found !== null && found >= from) return found;
      }
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

/** crontab's day rule on a calendar date: its month, and day-of-month OR
 * day-of-week when both are restricted (either one alone when only one is,
 * every day when neither is). */
function cronDayMatches(cron: CronSchedule, date: CalendarDate): boolean {
  if (!cron.month.values.has(date.month)) return false;
  const weekday = weekdayOf(date);
  const dayOfWeek =
    cron.dayOfWeek.values.has(weekday) ||
    (weekday === 0 && cron.dayOfWeek.values.has(7));
  const dayOfMonth = cron.dayOfMonth.values.has(date.day);
  if (cron.dayOfMonth.wildcard && cron.dayOfWeek.wildcard) return true;
  if (cron.dayOfMonth.wildcard) return dayOfWeek;
  if (cron.dayOfWeek.wildcard) return dayOfMonth;
  return dayOfMonth || dayOfWeek;
}

function cronDays(cron: CronSchedule): DayWalk {
  return {
    atOrAfter: (date) => {
      const limit = addDays(date, CRON_HORIZON_DAYS);
      let day = date;
      while (compareDates(day, limit) <= 0) {
        if (!cron.month.values.has(day.month)) {
          day = clampedDate(day.year, day.month + 1, 1);
        } else if (cronDayMatches(cron, day)) {
          return day;
        } else {
          day = addDays(day, 1);
        }
      }
      return null;
    },
    atOrBefore: (date) => {
      const limit = addDays(date, -CRON_HORIZON_DAYS);
      let day = date;
      while (compareDates(day, limit) >= 0) {
        if (!cron.month.values.has(day.month)) {
          day = clampedDate(day.year, day.month - 1, 31);
        } else if (cronDayMatches(cron, day)) {
          return day;
        } else {
          day = addDays(day, -1);
        }
      }
      return null;
    },
  };
}

const ascending = (values: Set<number>) =>
  [...values].toSorted((a, b) => a - b);

function cronGridPlan(cron: CronSchedule, zone: string): GridPlan {
  const hours = ascending(cron.hour.values);
  const minutes = ascending(cron.minute.values);
  return {
    kind: 'grid',
    zone,
    notBefore: Number.NEGATIVE_INFINITY,
    ...cronDays(cron),
    minuteAtOrAfter: (date, minute) => {
      if (!cronDayMatches(cron, date)) return null;
      const hourNow = Math.floor(minute / 60);
      for (const hour of hours) {
        if (hour < hourNow) continue;
        const from = hour === hourNow ? minute % 60 : 0;
        const found = minutes.find((value) => value >= from);
        if (found !== undefined) return hour * 60 + found;
      }
      return null;
    },
    minuteAtOrBefore: (date, minute) => {
      if (!cronDayMatches(cron, date)) return null;
      const hourNow = Math.floor(minute / 60);
      for (const hour of hours.toReversed()) {
        if (hour > hourNow) continue;
        const to = hour === hourNow ? minute % 60 : 59;
        const found = minutes.findLast((value) => value <= to);
        if (found !== undefined) return hour * 60 + found;
      }
      return null;
    },
  };
}

function cronNamedPlan(cron: CronSchedule, zone: string): NamedPlan {
  const times: ClockTime[] = [];
  for (const hour of ascending(cron.hour.values)) {
    for (const minute of ascending(cron.minute.values)) {
      times.push({ hour, minute });
    }
  }
  return { kind: 'named', zone, times, ...cronDays(cron) };
}

// ---------------------------------------------------------------------------
// Plans and walks
// ---------------------------------------------------------------------------

function planOf(schedule: Schedule): Plan {
  if (schedule.type === 'cron') {
    return schedule.dstClass === 'grid'
      ? cronGridPlan(schedule.cron, schedule.timezone)
      : cronNamedPlan(schedule.cron, schedule.timezone);
  }
  const { rule, timezone, startDate } = schedule;
  if (rule.frequency === 'minutely' || rule.frequency === 'hourly') {
    return gridPlan(rule, timezone, startDate);
  }
  return {
    kind: 'named',
    zone: timezone,
    times: clockTimes(rule.times),
    ...ruleDays(rule, startDate),
  };
}

/** Every start a named plan has on `day`, resolved in its zone and in
 * order; two times that land on one instant start once, and the one the
 * clock did not move speaks for it. */
function namedOn(plan: NamedPlan, day: CalendarDate): Found[] {
  const byInstant = new Map<number, Found>();
  for (const time of plan.times) {
    const candidates = zonedCandidates(day, time, plan.zone);
    const first = candidates[0];
    const found: Found =
      first === undefined
        ? {
            at: zonedInstant(day, time, plan.zone),
            clockChange: {
              kind: 'shiftedForward',
              wallTime: formatScheduleTime(time),
            },
          }
        : candidates.length > 1
          ? {
              at: first,
              clockChange: { kind: 'repeatedHour', interval: false },
            }
          : { at: first };
    const held = byInstant.get(found.at);
    if (held === undefined || held.clockChange?.kind === 'shiftedForward') {
      byInstant.set(found.at, found);
    }
  }
  return [...byInstant.values()].toSorted((a, b) => a.at - b.at);
}

function nextNamed(plan: NamedPlan, after: number): Found | null {
  let date = addDays(localDateIn(after, plan.zone), -1);
  for (let step = 0; step < NAMED_STEPS; step += 1) {
    const day = plan.atOrAfter(date);
    if (day === null) return null;
    const found = namedOn(plan, day).find((start) => start.at > after);
    if (found !== undefined) return found;
    date = addDays(day, 1);
  }
  return null;
}

function previousNamed(
  plan: NamedPlan,
  atOrBefore: number,
  floor: number,
): Found | null {
  let date = addDays(localDateIn(atOrBefore, plan.zone), 1);
  for (let step = 0; step < NAMED_STEPS; step += 1) {
    const day = plan.atOrBefore(date);
    if (day === null) return null;
    const found = namedOn(plan, day).findLast(
      (start) => start.at <= atOrBefore,
    );
    if (found !== undefined) return found.at >= floor ? found : null;
    date = addDays(day, -1);
  }
  return null;
}

const minuteFloor = (ms: number) => Math.floor(ms / MINUTE_MS) * MINUTE_MS;

function sameDay(a: CalendarDate, b: CalendarDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** The wall-clock day and minute of the day at `at`. */
function localMinute(
  at: number,
  zone: string,
): { date: CalendarDate; minute: number } {
  const clock = wallClockIn(at, zone);
  return {
    date: { year: clock.year, month: clock.month, day: clock.day },
    minute: clock.hour * 60 + clock.minute,
  };
}

/** The first whole minute in (`from`, `to`] whose offset is no longer the
 * one at `from` — where a clock change falls. `to` when none does. */
function changeAfter(from: number, to: number, zone: string): number {
  const offset = offsetAt(from, zone);
  if (offsetAt(to, zone) === offset) return to;
  let low = from;
  let high = to;
  while (high - low > MINUTE_MS) {
    const middle = low + minuteFloor((high - low) / 2);
    if (offsetAt(middle, zone) === offset) low = middle;
    else high = middle;
  }
  return high;
}

/** The last whole minute in [`to`, `from`) whose offset is not the one at
 * `from` — the minute before a clock change, walking back. `to` when none
 * is. */
function changeBefore(from: number, to: number, zone: string): number {
  const offset = offsetAt(from, zone);
  if (offsetAt(to, zone) === offset) return to;
  let low = to;
  let high = from;
  while (high - low > MINUTE_MS) {
    const middle = low + minuteFloor((high - low) / 2);
    if (offsetAt(middle, zone) === offset) high = middle;
    else low = middle;
  }
  return low;
}

/**
 * The grid's first start strictly after `after`. It reads the wall clock,
 * moves by the elapsed minutes to the next grid minute, and checks that the
 * clock reads it there: when a change fell in between, it continues from
 * the change instead, so no start after a repeated hour is jumped over.
 */
function nextGrid(plan: GridPlan, after: number): number | null {
  let at = Math.max(
    minuteFloor(after) + MINUTE_MS,
    Math.ceil(plan.notBefore / MINUTE_MS) * MINUTE_MS,
  );
  for (let step = 0; step < GRID_STEPS; step += 1) {
    const { date, minute } = localMinute(at, plan.zone);
    const next = plan.minuteAtOrAfter(date, minute);
    if (next === minute) return at;
    if (next === null) {
      const day = plan.atOrAfter(addDays(date, 1));
      if (day === null) return null;
      at = Math.max(at + MINUTE_MS, zonedInstant(day, MIDNIGHT, plan.zone));
      continue;
    }
    const target = at + (next - minute) * MINUTE_MS;
    const landed = localMinute(target, plan.zone);
    if (sameDay(landed.date, date) && landed.minute === next) return target;
    at = Math.max(at + MINUTE_MS, changeAfter(at, target, plan.zone));
  }
  return null;
}

/** The grid's last start at or before `atOrBefore` and not before `floor`
 * — {@link nextGrid}, walking back. */
function previousGrid(
  plan: GridPlan,
  atOrBefore: number,
  floor: number,
): number | null {
  const lowest = Math.max(floor, plan.notBefore);
  let at = minuteFloor(atOrBefore);
  for (let step = 0; step < GRID_STEPS && at >= lowest; step += 1) {
    const { date, minute } = localMinute(at, plan.zone);
    const previous = plan.minuteAtOrBefore(date, minute);
    if (previous === minute) return at;
    if (previous === null) {
      const day = plan.atOrBefore(addDays(date, -1));
      if (day === null) return null;
      const dayEnd =
        zonedInstant(addDays(day, 1), MIDNIGHT, plan.zone) - MINUTE_MS;
      at = Math.min(at - MINUTE_MS, dayEnd);
      continue;
    }
    const target = at - (minute - previous) * MINUTE_MS;
    const landed = localMinute(target, plan.zone);
    if (sameDay(landed.date, date) && landed.minute === previous) {
      return target >= lowest ? target : null;
    }
    at = Math.min(at - MINUTE_MS, changeBefore(at, target, plan.zone));
  }
  return null;
}

/** A grid start's mark: its local time occurs twice that day. */
function gridFound(plan: GridPlan, at: number): Found {
  const clock = wallClockIn(at, plan.zone);
  const repeated =
    zonedCandidates(
      { year: clock.year, month: clock.month, day: clock.day },
      { hour: clock.hour, minute: clock.minute },
      plan.zone,
    ).length > 1;
  return repeated
    ? { at, clockChange: { kind: 'repeatedHour', interval: true } }
    : { at };
}

function nextIn(plan: Plan, after: number): number | null {
  return plan.kind === 'named'
    ? (nextNamed(plan, after)?.at ?? null)
    : nextGrid(plan, after);
}

function previousIn(
  plan: Plan,
  atOrBefore: number,
  floor: number,
): number | null {
  return plan.kind === 'named'
    ? (previousNamed(plan, atOrBefore, floor)?.at ?? null)
    : previousGrid(plan, atOrBefore, floor);
}

function countIn(
  plan: Plan,
  from: number,
  to: number,
  cap: number,
): { count: number; capped: boolean } {
  let count = 0;
  let at = from - 1;
  for (;;) {
    const next = nextIn(plan, at);
    if (next === null || next > to) return { count, capped: false };
    if (count === cap) return { count, capped: true };
    count += 1;
    at = next;
  }
}

// ---------------------------------------------------------------------------
// The public walks
// ---------------------------------------------------------------------------

/** The schedule's first start strictly after `after`, or null when none
 * comes within its horizon (a cron day that never falls in eight years). */
export function nextOccurrence(
  schedule: Schedule,
  after: number,
): number | null {
  return nextIn(planOf(schedule), after);
}

/** The schedule's last start at or before `atOrBefore` and not before
 * `floor`, or null. */
export function previousOccurrence(
  schedule: Schedule,
  atOrBefore: number,
  floor = Number.NEGATIVE_INFINITY,
): number | null {
  return previousIn(planOf(schedule), atOrBefore, floor);
}

/** The next `count` starts strictly after `after`, in order. */
export function occurrencesAfter(
  schedule: Schedule,
  after: number,
  count: number,
): number[] {
  const plan = planOf(schedule);
  const starts: number[] = [];
  let at = after;
  while (starts.length < count) {
    const next = nextIn(plan, at);
    if (next === null) break;
    starts.push(next);
    at = next;
  }
  return starts;
}

/**
 * The next `count` starts strictly after `after`, each marked when a clock
 * change touches it: a named time the clock skipped (`shiftedForward`), a
 * named time or a grid start whose local time occurs twice that day
 * (`repeatedHour`). A grid minute the clock skipped does not exist, so it is
 * not listed and not marked.
 */
export function upcomingOccurrences(
  schedule: Schedule,
  after: number,
  count: number,
): ScheduleOccurrenceData[] {
  const plan = planOf(schedule);
  const starts: ScheduleOccurrenceData[] = [];
  let at = after;
  while (starts.length < count) {
    let found: Found | null;
    if (plan.kind === 'named') {
      found = nextNamed(plan, at);
    } else {
      const next = nextGrid(plan, at);
      found = next === null ? null : gridFound(plan, next);
    }
    if (found === null) break;
    starts.push({
      at: found.at,
      timeZone: schedule.timezone,
      ...(found.clockChange !== undefined
        ? { clockChange: found.clockChange }
        : {}),
    });
    at = found.at;
  }
  return starts;
}

/** How many starts fall in [`from`, `to`], counted up to `cap`; `capped`
 * says more did. */
export function countBetween(
  schedule: Schedule,
  from: number,
  to: number,
  cap: number,
): { count: number; capped: boolean } {
  return countIn(planOf(schedule), from, to, cap);
}

/** What a scan does with a schedule that came due. */
export interface DueDecision {
  /** The occurrence to start a run for, or null. */
  fire: number | null;
  /** The latest occurrence this decision handled, fired or missed — the
   * claim the next scan starts after. */
  handledThrough: number;
  /** The pending occurrences that were not fired, or null when none. */
  missed: {
    count: number;
    /** `count` is {@link MISSED_COUNT_CAP} and more were missed. */
    capped: boolean;
    firstAt: number;
    lastAt: number;
  } | null;
  /** The first occurrence strictly after `now`; null when none comes. */
  next: number | null;
}

/**
 * Decide a due schedule. Pending are the occurrences from `pendingFrom` to
 * `now` that are later than `handledThrough` (what an earlier scan, of
 * either image, already claimed). At most one starts: the latest. With
 * `latest` it starts however late; with `skip` only within
 * {@link SCHEDULE_ON_TIME_GRACE_MS}. Every other pending occurrence is
 * counted as missed. The latest pending occurrence is at most one period
 * old, so `latest` needs no age limit: a monthly 09:00 after an outage from
 * 08:30 to 10:30 starts at 10:30.
 */
export function decideDue(
  schedule: Schedule,
  pendingFrom: number,
  handledThrough: number,
  now: number,
  catchUp: 'latest' | 'skip',
): DueDecision {
  const plan = planOf(schedule);
  const floor = Math.max(pendingFrom, handledThrough + 1);
  const next = nextIn(plan, now);
  const latest = previousIn(plan, now, floor);
  if (latest === null) {
    return { fire: null, handledThrough, missed: null, next };
  }
  const fire =
    catchUp === 'latest' || now - latest <= SCHEDULE_ON_TIME_GRACE_MS
      ? latest
      : null;
  const fired = fire === null ? 0 : 1;
  const pending = countIn(plan, floor, latest, MISSED_COUNT_CAP + fired);
  const count = pending.count - fired;
  let missed: DueDecision['missed'] = null;
  if (count > 0) {
    const firstAt = nextIn(plan, floor - 1) ?? latest;
    const lastAt =
      fire === null ? latest : (previousIn(plan, latest - 1, floor) ?? latest);
    missed = { count, capped: pending.capped, firstAt, lastAt };
  }
  return {
    fire,
    handledThrough: Math.max(handledThrough, latest),
    missed,
    next,
  };
}

// ---------------------------------------------------------------------------
// A trigger row's schedule
// ---------------------------------------------------------------------------

/** The columns a schedule trigger keeps its definition in. */
export interface ScheduleSource {
  cron: string | null;
  timezone: string | null;
  /** `{repeat, startDate}` as stored, unread. */
  scheduleRule: unknown;
}

const storedRuleSchema = z.object({
  repeat: scheduleRuleSchema,
  startDate: z.string(),
});

/**
 * The schedule a trigger row describes, or why it describes none. A
 * non-empty cron wins over a stored rule: it is the newer intent when an
 * image that knows only cron saved over a rule row. A cron without a zone
 * reads in UTC, as it always has; a rule needs its zone.
 */
export function scheduleOfTrigger(
  source: ScheduleSource,
): { schedule: Schedule } | { issue: string } {
  const cron = source.cron?.trim() ?? '';
  const zoneText = source.timezone?.trim() ?? '';
  if (cron !== '') {
    const zone = zoneText === '' ? 'UTC' : canonicalTimeZone(zoneText);
    if (zone === null) return { issue: `unknown time zone "${zoneText}"` };
    let parsed: CronSchedule;
    try {
      parsed = parseCron(cron);
    } catch (error) {
      return {
        issue: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      schedule: {
        type: 'cron',
        cron: parsed,
        timezone: zone,
        dstClass: cronDstClass(parsed),
      },
    };
  }
  if (source.scheduleRule === null || source.scheduleRule === undefined) {
    return { issue: 'the schedule has neither a cron expression nor a rule' };
  }
  const stored = storedRuleSchema.safeParse(source.scheduleRule);
  if (!stored.success) {
    return {
      issue: `the stored repeat rule is unreadable: ${stored.error.issues[0]?.message ?? 'invalid'}`,
    };
  }
  const startDate = parseIsoDate(stored.data.startDate);
  if (startDate === null) {
    return { issue: `the start date "${stored.data.startDate}" is no day` };
  }
  if (zoneText === '') return { issue: 'a repeat rule needs a time zone' };
  const zone = canonicalTimeZone(zoneText);
  if (zone === null) return { issue: `unknown time zone "${zoneText}"` };
  return {
    schedule: {
      type: 'rule',
      rule: normalizeScheduleRule(stored.data.repeat),
      timezone: zone,
      startDate,
    },
  };
}
