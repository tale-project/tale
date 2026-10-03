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
  type CalendarDay,
  isWorkweek,
  type RecurrenceRule,
  WEEKDAYS_MONDAY_FIRST,
} from './rule';

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
