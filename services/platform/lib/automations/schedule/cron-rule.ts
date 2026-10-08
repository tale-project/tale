/**
 * Cron expressions and repeat rules, each read as the other where nothing
 * is lost — daylight-saving behaviour included. A stored cron opens in the
 * editor's repeat picker only when it converts, and the picker's Cron view
 * shows the expression a rule is, or says no single expression is.
 *
 * Lossless means the same starts in every zone: a grid cron (minute or
 * hour starting with `*`) becomes a grid rule, a named cron (both spelled
 * out) a day rule with times, so the two land in the same daylight-saving
 * class (`cronDstClass`). Anything else stays what it is:
 *
 * | Cron | Rule |
 * | --- | --- |
 * | every N minutes, every hour, every day | minutely/N |
 * | every N minutes in hours H1–H2, on days D | minutely/N, window D, H1:00 until H2+1:00 |
 * | every N minutes on days D | minutely/N, window D |
 * | minute M of every Hth hour | hourly/H at M |
 * | minutes × hours every day (at most 12) | daily, those times |
 * | minutes × hours on days D | weekly on D, those times |
 * | day d ≤ 28 of every month | monthly on d |
 * | day d ≤ 28 of every Nth month from January (N divides 12) | monthly/N on d, phased from January |
 * | day d of month m, February 29 excepted | yearly on m/d |
 *
 * Not converted: a day of the month and a weekday both restricted (crontab
 * reads them as either), days 29–31 every month (cron skips a short month,
 * a rule takes its last day), February 29 (cron waits for a leap year, a
 * rule takes the 28th), a stepped hour list with a minute grid, and more
 * than twelve times a day.
 */

import {
  formatScheduleTime,
  parseScheduleTime,
  SCHEDULE_HOUR_INTERVALS,
  SCHEDULE_MAX_TIMES,
  SCHEDULE_MINUTE_INTERVALS,
  type ScheduleRule,
  type ScheduleWindow,
} from '@tale/shared/schemas/schedule-rule';

import {
  type CalendarDate,
  compareDates,
  firstRuleDay,
} from '../../shared/calendar.ts';
import { type CronSchedule, cronDstClass, parseCron } from '../cron.ts';

/** The month steps that divide a year, so a step from January lands on
 * the same months every year. */
const MONTH_STEPS = [1, 2, 3, 4, 6, 12] as const;
/** Days each month always has — February only its 28. */
const SURE_MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

const sorted = (values: Iterable<number>) =>
  [...new Set(values)].toSorted((a, b) => a - b);

/** The step `values` walk from 0 by, when they are exactly 0, s, 2s, … up
 * to `max`; null otherwise. */
function stepOf<T extends number>(
  values: readonly number[],
  steps: readonly T[],
  max: number,
): T | null {
  for (const step of steps) {
    const expected: number[] = [];
    for (let value = 0; value <= max; value += step) expected.push(value);
    if (
      expected.length === values.length &&
      expected.every((value, i) => value === values[i])
    ) {
      return step;
    }
  }
  return null;
}

/** Whether `values` are consecutive integers. */
function contiguous(values: readonly number[]): boolean {
  return values.every(
    (value, i) => i === 0 || value === (values[i - 1] ?? 0) + 1,
  );
}

/** Day-of-week values as `Date#getDay` numbers (crontab's 7 is Sunday). */
function weekdaysOf(cron: CronSchedule): number[] {
  return sorted([...cron.dayOfWeek.values].map((day) => day % 7));
}

function everyMonth(cron: CronSchedule): boolean {
  return cron.month.values.size === 12;
}

/** The days a cron runs on, when they are every day or some weekdays —
 * day-of-month unrestricted, every month. */
function weekdayDays(cron: CronSchedule): number[] | null {
  if (!cron.dayOfMonth.wildcard || !everyMonth(cron)) return null;
  if (cron.dayOfWeek.wildcard) return ALL_WEEKDAYS;
  const days = weekdaysOf(cron);
  return days.length === 7 ? ALL_WEEKDAYS : days;
}

function gridRule(cron: CronSchedule): ScheduleRule | null {
  const minutes = sorted(cron.minute.values);
  const hours = sorted(cron.hour.values);
  const days = weekdayDays(cron);
  if (days === null) return null;
  const minuteStep = stepOf(minutes, SCHEDULE_MINUTE_INTERVALS, 59);
  if (minuteStep !== null) {
    const interval = minuteStep;
    if (hours.length === 24) {
      return days.length === 7
        ? { frequency: 'minutely', interval }
        : { frequency: 'minutely', interval, window: { weekdays: days } };
    }
    if (!contiguous(hours)) return null;
    const first = hours[0] ?? 0;
    const last = hours.at(-1) ?? 0;
    const window: ScheduleWindow = {
      weekdays: days,
      hours: {
        from: formatScheduleTime({ hour: first, minute: 0 }),
        to: formatScheduleTime({ hour: (last + 1) % 24, minute: 0 }),
      },
    };
    return { frequency: 'minutely', interval, window };
  }
  const minute = minutes[0];
  if (minutes.length !== 1 || minute === undefined || days.length !== 7) {
    return null;
  }
  const hourStep = stepOf(hours, SCHEDULE_HOUR_INTERVALS, 23);
  if (hourStep === null) return null;
  return {
    frequency: 'hourly',
    interval: hourStep,
    minute,
  };
}

function namedRule(cron: CronSchedule): ScheduleRule | null {
  const minutes = sorted(cron.minute.values);
  const hours = sorted(cron.hour.values);
  if (minutes.length * hours.length > SCHEDULE_MAX_TIMES) return null;
  const times = hours.flatMap((hour) =>
    minutes.map((minute) => formatScheduleTime({ hour, minute })),
  );
  const days = weekdayDays(cron);
  if (days !== null) {
    return days.length === 7
      ? { frequency: 'daily', interval: 1, times }
      : { frequency: 'weekly', interval: 1, weekdays: days, times };
  }
  // Day-of-month restricted: one day, any weekday.
  const monthDays = sorted(cron.dayOfMonth.values);
  const monthDay = monthDays[0];
  if (
    cron.dayOfMonth.wildcard ||
    !cron.dayOfWeek.wildcard ||
    monthDays.length !== 1 ||
    monthDay === undefined
  ) {
    return null;
  }
  const months = sorted(cron.month.values);
  const month = months[0];
  if (months.length === 1 && month !== undefined) {
    if (month === 2 && monthDay === 29) return null;
    if (monthDay > (SURE_MONTH_DAYS[month - 1] ?? 0)) return null;
    return { frequency: 'yearly', interval: 1, month, monthDay, times };
  }
  if (monthDay > 28) return null;
  const step = stepOf(
    months.map((value) => value - 1),
    MONTH_STEPS,
    11,
  );
  if (step === null) return null;
  return { frequency: 'monthly', interval: step, monthDay, times };
}

/**
 * The repeat rule a cron expression is, or null when none says exactly the
 * same — the expression does not parse, or the table above has no row for
 * it. A monthly rule with a step starts its phase in January: give it a
 * start date from {@link cronRuleStartDate}.
 */
export function cronToScheduleRule(expression: string): ScheduleRule | null {
  let cron: CronSchedule;
  try {
    cron = parseCron(expression);
  } catch (error) {
    // An expression the parse refuses converts to nothing; the cron field
    // reports the refusal itself.
    if (error instanceof Error) return null;
    throw error;
  }
  return cronDstClass(cron) === 'grid' ? gridRule(cron) : namedRule(cron);
}

/** The start date a rule converted from cron keeps the cron's months
 * under: January 1 of the year `today` falls in. Only a monthly rule with
 * a step depends on it; for every other converted rule any past day
 * serves. */
export function cronRuleStartDate(today: CalendarDate): CalendarDate {
  return { year: today.year, month: 1, day: 1 };
}

/** A crontab list: runs of three or more as ranges (`1-5`), the rest
 * comma-separated. */
function cronList(values: readonly number[]): string {
  const parts: string[] = [];
  let i = 0;
  const all = sorted(values);
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && (all[j + 1] ?? 0) === (all[j] ?? 0) + 1) {
      j += 1;
    }
    if (j - i >= 2) {
      parts.push(`${all[i]}-${all[j]}`);
    } else {
      for (let k = i; k <= j; k += 1) parts.push(String(all[k]));
    }
    i = j + 1;
  }
  return parts.join(',');
}

function weekdayField(weekdays: readonly number[]): string {
  return sorted(weekdays).length === 7 ? '*' : cronList(weekdays);
}

/** The minute and hour fields of a day rule's times, when the times are
 * every pairing of some minutes and some hours; null otherwise. */
function timeFields(
  times: readonly string[],
): { minute: string; hour: string } | null {
  const parsed = [...new Set(times)].map(parseScheduleTime);
  const minutes = new Set<number>();
  const hours = new Set<number>();
  for (const time of parsed) {
    if (time === null) return null;
    minutes.add(time.minute);
    hours.add(time.hour);
  }
  if (minutes.size * hours.size !== parsed.length) return null;
  return { minute: cronList([...minutes]), hour: cronList([...hours]) };
}

/** A rule's start date, and the day it is in the rule's zone. */
export interface ScheduleRuleDates {
  startDate: CalendarDate;
  today: CalendarDate;
}

/**
 * The cron expression a repeat rule is, or null when no single expression
 * says exactly the same: a rule that waits for a start date after `today`
 * (a cron has no start date, so it would start at once), a day rule
 * stepping more than one period (but a monthly one phased from January,
 * given its dates), times that are not every pairing of some minutes and
 * hours, days 29–31 every month, February 29, a window that runs overnight
 * or starts or ends off the hour, and an hourly rule with a window. Without
 * `dates` the rule is read as already started.
 */
export function scheduleRuleToCron(
  rule: ScheduleRule,
  dates?: ScheduleRuleDates,
): string | null {
  if (dates !== undefined && compareDates(dates.startDate, dates.today) > 0) {
    return null;
  }
  switch (rule.frequency) {
    case 'minutely': {
      const minute = rule.interval === 1 ? '*' : `*/${rule.interval}`;
      const window = rule.window;
      if (window === undefined) return `${minute} * * * *`;
      const days = weekdayField(window.weekdays);
      if (window.hours === undefined) return `${minute} * * * ${days}`;
      const from = parseScheduleTime(window.hours.from);
      const to = parseScheduleTime(window.hours.to);
      if (from === null || to === null) return null;
      if (from.minute !== 0 || to.minute !== 0) return null;
      const end = to.hour === 0 ? 24 : to.hour;
      if (end <= from.hour) return null;
      const hours =
        end - 1 === from.hour ? `${from.hour}` : `${from.hour}-${end - 1}`;
      return `${minute} ${hours} * * ${days}`;
    }
    case 'hourly':
      if (rule.window !== undefined) return null;
      return rule.interval === 1
        ? `${rule.minute} * * * *`
        : `${rule.minute} */${rule.interval} * * *`;
    case 'daily': {
      const fields = timeFields(rule.times);
      if (fields === null || rule.interval !== 1) return null;
      return `${fields.minute} ${fields.hour} * * *`;
    }
    case 'weekly': {
      const fields = timeFields(rule.times);
      if (fields === null || rule.interval !== 1) return null;
      return `${fields.minute} ${fields.hour} * * ${weekdayField(rule.weekdays)}`;
    }
    case 'monthly': {
      const fields = timeFields(rule.times);
      if (fields === null || rule.monthDay > 28) return null;
      const head = `${fields.minute} ${fields.hour} ${rule.monthDay}`;
      if (rule.interval === 1) return `${head} * *`;
      if (!MONTH_STEPS.some((step) => step === rule.interval)) {
        return null;
      }
      if (dates === undefined) return null;
      const anchor = firstRuleDay(rule, dates.startDate);
      if ((anchor.month - 1) % rule.interval !== 0) return null;
      return `${head} */${rule.interval} *`;
    }
    case 'yearly': {
      const fields = timeFields(rule.times);
      if (fields === null || rule.interval !== 1) return null;
      if (rule.month === 2 && rule.monthDay === 29) return null;
      return `${fields.minute} ${fields.hour} ${rule.monthDay} ${rule.month} *`;
    }
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}
