/**
 * A recurrence rule in words — the full sentence for tooltips, activity lines
 * and screen readers ("Every 2 weeks on Tuesday and Thursday"), and a compact
 * head and tail for a narrow trigger ("Every 2 weeks" · "Tue, Thu").
 *
 * `t` is bound to the `recurrence` namespace of `@tale/ui`'s catalog; every key
 * is a literal inside an exhaustive switch. Day and month names come from
 * `Intl` in the reader's locale, so no catalog carries them.
 */

import type { TFunction } from 'i18next';

import {
  formatTimeOfDay,
  type HourCycle,
  localHourCycle,
} from '../time-of-day';
import {
  type CalendarDay,
  isWorkweek,
  type RecurrenceRule,
  WEEKDAYS_MONDAY_FIRST,
} from './rule';
import {
  isScheduleGrid,
  parseScheduleTime,
  type ScheduleDayRule,
  type ScheduleGridRule,
  type ScheduleOccurrence,
  type ScheduleRule,
  type ScheduleWindow,
  scheduleDays,
} from './schedule';

/** The compact trigger label: a head that always shows, and a tail that
 *  drops out whole when the column is too narrow for it. */
export interface RecurrenceCompactLabel {
  head: string;
  tail?: string;
}

/** A Sunday at UTC midnight: weekday `n` is this instant plus `n` days. */
const SUNDAY_UTC = Date.UTC(2024, 0, 7);
const DAY_MS = 86_400_000;
/** A leap year, so February 29 has a date to format. */
const LEAP_YEAR = 2000;

/** The weekday lists a compact tail spells out; more read as a count. */
const COMPACT_MAX_DAYS = 3;

/** The locale's own name for a `Date#getDay` weekday. */
export function weekdayName(
  weekday: number,
  locale: string,
  width: 'long' | 'short' = 'long',
): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: width,
    timeZone: 'UTC',
  }).format(SUNDAY_UTC + weekday * DAY_MS);
}

/** The locale's long name for a month (1 is January) — "September". */
export function monthName(month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    timeZone: 'UTC',
  }).format(Date.UTC(LEAP_YEAR, month - 1, 1));
}

/** A month and day without a year, in the locale's short form — "Sep 30". */
export function monthDayName(
  month: number,
  day: number,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(LEAP_YEAR, month - 1, day));
}

/**
 * Whether the locale writes the day before the month ("30 September",
 * "30. September") — the order the editor lays its month and day fields in.
 */
export function dayBeforeMonth(locale: string): boolean {
  const parts = new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(Date.UTC(LEAP_YEAR, 8, 30));
  const day = parts.findIndex((part) => part.type === 'day');
  const month = parts.findIndex((part) => part.type === 'month');
  return day !== -1 && month !== -1 && day < month;
}

/**
 * A calendar day with its weekday — "Tue, Oct 6" — and its year when that
 * differs from `referenceYear` ("Sun, Feb 28, 2027").
 */
export function formatCalendarDay(
  day: CalendarDay,
  locale: string,
  options: { referenceYear?: number } = {},
): string {
  const date = new Date(0);
  date.setUTCFullYear(day.year, day.month - 1, day.day);
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year:
      options.referenceYear !== undefined && day.year !== options.referenceYear
        ? 'numeric'
        : undefined,
    timeZone: 'UTC',
  }).format(date);
}

/** A rule's weekdays, deduplicated and Monday first. */
function mondayFirst(weekdays: readonly number[]): number[] {
  const days = new Set(weekdays);
  return WEEKDAYS_MONDAY_FIRST.filter((day) => days.has(day));
}

/** The rule as a sentence — "Every 2 weeks on Tuesday and Thursday". */
export function formatRecurrence(
  rule: RecurrenceRule,
  t: TFunction,
  locale: string,
): string {
  switch (rule.frequency) {
    case 'daily':
      return t('sentence.daily', { count: rule.interval });
    case 'weekly': {
      if (rule.interval === 1 && isWorkweek(rule.weekdays)) {
        return t('sentence.weekdays');
      }
      const days = mondayFirst(rule.weekdays).map((day) =>
        weekdayName(day, locale),
      );
      return t('sentence.weekly', {
        count: rule.interval,
        days: new Intl.ListFormat(locale, { type: 'conjunction' }).format(days),
      });
    }
    case 'monthly':
      return t('sentence.monthly', {
        count: rule.interval,
        day: rule.monthDay,
      });
    case 'yearly':
      return t('sentence.yearly', {
        count: rule.interval,
        date: monthDayName(rule.month, rule.monthDay, locale),
      });
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}

/** The rule for a narrow trigger — "Weekly" · "Tue, Thu". */
export function formatRecurrenceCompact(
  rule: RecurrenceRule,
  t: TFunction,
  locale: string,
): RecurrenceCompactLabel {
  switch (rule.frequency) {
    case 'daily':
      return { head: t('sentence.daily', { count: rule.interval }) };
    case 'weekly': {
      if (rule.interval === 1 && isWorkweek(rule.weekdays)) {
        return { head: t('compact.weekdays') };
      }
      const days = mondayFirst(rule.weekdays);
      const head = t('compact.weekly', { count: rule.interval });
      if (days.length > COMPACT_MAX_DAYS) {
        return { head, tail: t('compact.dayCount', { count: days.length }) };
      }
      // A plain comma list: the locale's list patterns join the last two
      // with a word ("Di. und Do.", "mar. et jeu."), too long for the tail.
      return {
        head,
        tail: days.map((day) => weekdayName(day, locale, 'short')).join(', '),
      };
    }
    case 'monthly':
      return {
        head: t('compact.monthly', { count: rule.interval }),
        tail: t('compact.monthDay', { day: rule.monthDay }),
      };
    case 'yearly':
      return {
        head: t('compact.yearly', { count: rule.interval }),
        tail: monthDayName(rule.month, rule.monthDay, locale),
      };
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}

/** A weekday chip's two-letter label ("Mo", "Tu"), Monday first. */
export function weekdayChipLabel(weekday: number, t: TFunction): string {
  switch (weekday) {
    case 1:
      return t('weekdayChip.monday');
    case 2:
      return t('weekdayChip.tuesday');
    case 3:
      return t('weekdayChip.wednesday');
    case 4:
      return t('weekdayChip.thursday');
    case 5:
      return t('weekdayChip.friday');
    case 6:
      return t('weekdayChip.saturday');
    default:
      return t('weekdayChip.sunday');
  }
}

/** A day rule lists its times up to this many; more read as a count. */
const COMPACT_MAX_TIMES = 2;

/** The `hourCycle` select the German catalog reads: "Uhr" after a 24-hour
 *  time, nothing after "9:00 AM". */
function cycleKey(cycle: HourCycle): 'h12' | 'h23' {
  return cycle === 12 ? 'h12' : 'h23';
}

/** The times of a day rule, in day order, as the locale writes them. */
function timeWords(
  rule: ScheduleDayRule,
  locale: string,
  cycle: HourCycle,
): string[] {
  return [...new Set(rule.times)]
    .toSorted()
    .map(parseScheduleTime)
    .filter((time) => time !== null)
    .map((time) => formatTimeOfDay(time, locale, cycle));
}

/**
 * A set of weekdays, Monday first — "Mon–Fri" for the workweek, "Tue–Thu"
 * for a run of three or more, "Mon, Wed, Fri" otherwise — or null for all
 * seven (no day limit).
 */
export function formatWeekdaySet(
  days: readonly number[],
  t: TFunction,
  locale: string,
): string | null {
  const ordered = mondayFirst(days);
  if (ordered.length === 0 || ordered.length === 7) return null;
  if (isWorkweek(ordered)) return t('workweekRange');
  const positions = ordered.map((day) => WEEKDAYS_MONDAY_FIRST.indexOf(day));
  const run = positions.every(
    (position, index) => index === 0 || position === positions[index - 1] + 1,
  );
  const first = ordered[0];
  const last = ordered.at(-1);
  if (run && ordered.length >= 3 && first !== undefined && last !== undefined) {
    return t('schedule.dayRange', {
      first: weekdayName(first, locale, 'short'),
      last: weekdayName(last, locale, 'short'),
    });
  }
  return ordered.map((day) => weekdayName(day, locale, 'short')).join(', ');
}

/** A window's hours, for a sentence ("8:00 AM–6:00 PM", "de 08:00 à
 *  18:00") or a compact tail ("08:00–18:00"). */
function hoursWords(
  hours: ScheduleWindow['hours'],
  t: TFunction,
  locale: string,
  cycle: HourCycle,
  compact: boolean,
): string | null {
  if (hours === undefined || hours.from === hours.to) return null;
  const from = parseScheduleTime(hours.from);
  const to = parseScheduleTime(hours.to);
  if (from === null || to === null) return null;
  const words = {
    from: formatTimeOfDay(from, locale, cycle),
    to: formatTimeOfDay(to, locale, cycle),
  };
  return compact
    ? t('schedule.compact.hoursRange', words)
    : t('schedule.hoursRange', { ...words, hourCycle: cycleKey(cycle) });
}

/** A grid's step — "Every 15 minutes", "Every 2 hours". */
function gridHead(rule: ScheduleGridRule, t: TFunction): string {
  return rule.frequency === 'minutely'
    ? t('schedule.sentence.minutely', { count: rule.interval })
    : t('schedule.sentence.hourly', { count: rule.interval });
}

/**
 * The schedule as a sentence — "Every weekday at 9:00 AM and 5:30 PM",
 * "Every 15 minutes, Mon–Fri, 8:00 AM–6:00 PM". Times follow the locale's
 * hour cycle unless `cycle` names one.
 */
export function formatSchedule(
  rule: ScheduleRule,
  t: TFunction,
  locale: string,
  cycle: HourCycle = localHourCycle(locale),
): string {
  if (isScheduleGrid(rule)) {
    const head =
      rule.frequency === 'hourly' && rule.minute > 0
        ? t('schedule.sentence.hourlyAt', {
            count: rule.interval,
            minute: rule.minute,
          })
        : gridHead(rule, t);
    const window = [
      rule.window ? formatWeekdaySet(rule.window.weekdays, t, locale) : null,
      hoursWords(rule.window?.hours, t, locale, cycle, false),
    ].filter((part) => part !== null);
    return window.length > 0
      ? t('schedule.sentence.withWindow', {
          rule: head,
          window: window.join(', '),
        })
      : head;
  }
  return t('schedule.sentence.withTimes', {
    rule: formatRecurrence(scheduleDays(rule), t, locale),
    times: new Intl.ListFormat(locale, { type: 'conjunction' }).format(
      timeWords(rule, locale, cycle),
    ),
    hourCycle: cycleKey(cycle),
  });
}

/**
 * The schedule for a narrow trigger — "Weekdays" · "9:00 AM, 5:30 PM",
 * "Every 15 minutes" · "Mon–Fri, 08:00–18:00". Three times or more read as
 * a count.
 */
export function formatScheduleCompact(
  rule: ScheduleRule,
  t: TFunction,
  locale: string,
  cycle: HourCycle = localHourCycle(locale),
): RecurrenceCompactLabel {
  if (isScheduleGrid(rule)) {
    const tail = [
      rule.frequency === 'hourly' && rule.minute > 0
        ? t('schedule.compact.minutePast', {
            mm: String(rule.minute).padStart(2, '0'),
          })
        : null,
      rule.window ? formatWeekdaySet(rule.window.weekdays, t, locale) : null,
      hoursWords(rule.window?.hours, t, locale, cycle, true),
    ].filter((part) => part !== null);
    return tail.length > 0
      ? { head: gridHead(rule, t), tail: tail.join(', ') }
      : { head: gridHead(rule, t) };
  }
  const days = formatRecurrenceCompact(scheduleDays(rule), t, locale);
  const words = timeWords(rule, locale, cycle);
  const many = words.length > COMPACT_MAX_TIMES;
  const times = many
    ? t('schedule.compact.timeCount', { count: words.length })
    : words.join(', ');
  if (days.tail === undefined) return { head: days.head, tail: times };
  return {
    head: days.head,
    tail: many
      ? `${days.tail}, ${times}`
      : t('schedule.compact.at', { days: days.tail, times }),
  };
}

/** The calendar part of an instant in a zone — "Tue, Oct 13", with the year
 *  when it differs from `referenceYear`. */
export function formatZonedDate(
  at: number,
  timeZone: string,
  locale: string,
  referenceYear?: number,
): string {
  const year = Number(
    new Intl.DateTimeFormat('en', { year: 'numeric', timeZone }).format(at),
  );
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year:
      referenceYear !== undefined && year !== referenceYear
        ? 'numeric'
        : undefined,
    timeZone,
  }).format(at);
}

/** The clock part of an instant in a zone — "9:00 AM", "09:00". */
export function formatZonedTime(
  at: number,
  timeZone: string,
  locale: string,
  cycle: HourCycle = localHourCycle(locale),
): string {
  return new Intl.DateTimeFormat(locale, {
    timeStyle: 'short',
    hourCycle: cycleKey(cycle),
    timeZone,
  }).format(at);
}

/** One upcoming start in its schedule's zone — "Tue, Oct 13, 9:00 AM". */
export function formatOccurrence(
  occurrence: ScheduleOccurrence,
  t: TFunction,
  locale: string,
  options: { referenceYear?: number; cycle?: HourCycle } = {},
): string {
  return t('occurrences.dateTime', {
    date: formatZonedDate(
      occurrence.at,
      occurrence.timeZone,
      locale,
      options.referenceYear,
    ),
    time: formatZonedTime(
      occurrence.at,
      occurrence.timeZone,
      locale,
      options.cycle,
    ),
  });
}
