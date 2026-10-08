/**
 * Calendar dates without a zone — the day arithmetic shared by repeating
 * tasks (`task-repeat.ts`) and automation schedules
 * (`lib/automations/schedule/occurrences.ts`), so the same rule words name
 * the same days on both: a monthly 31st clamps to a short month's last day,
 * a yearly February 29 lands on the 28th in a common year, and weeks run
 * Monday to Sunday.
 *
 * Every step runs on a UTC stand-in, so no daylight-saving change can move a
 * date. Which instant a date and a time of day name in a zone is the caller's
 * half (`zoned-time.ts`).
 */

const DAY_MS = 86_400_000;

export function calendarRangeError(): RangeError {
  return new RangeError(
    'The repeat date is outside the supported calendar range',
  );
}

/** `ms` itself, when a `Date` can hold it; a range error otherwise. */
export function validInstant(ms: number): number {
  if (!Number.isFinite(new Date(ms).getTime())) throw calendarRangeError();
  return ms;
}

/** A wall-calendar day; `month` is 1-based. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/**
 * The zone-free half of a day rule: which calendar days it names and the
 * step between them. A task's stored rule and a schedule's day rule both
 * carry these keys, so both step through the same function.
 */
export type CalendarRule =
  | { frequency: 'daily'; interval: number }
  | { frequency: 'weekly'; interval: number; weekdays: readonly number[] }
  | { frequency: 'monthly'; interval: number; monthDay: number }
  | {
      frequency: 'yearly';
      interval: number;
      month: number;
      monthDay: number;
    };

/** Calendar arithmetic runs on a UTC stand-in: no zone, no DST. */
export function toUtc(date: CalendarDate): number {
  return validInstant(Date.UTC(date.year, date.month - 1, date.day));
}

export function fromUtc(ms: number): CalendarDate {
  const d = new Date(validInstant(ms));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** `Date#getDay` of a calendar date: 0 is Sunday. */
export function weekdayOf(date: CalendarDate): number {
  return new Date(toUtc(date)).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(validInstant(Date.UTC(year, month, 0))).getUTCDate();
}

/** `month` may run past 12 (or below 1); it rolls into the year. */
export function clampedDate(
  year: number,
  month: number,
  day: number,
): CalendarDate {
  const y = year + Math.floor((month - 1) / 12);
  const m = ((((month - 1) % 12) + 12) % 12) + 1;
  return { year: y, month: m, day: Math.min(day, daysInMonth(y, m)) };
}

export function isAfter(a: CalendarDate, b: CalendarDate): boolean {
  return toUtc(a) > toUtc(b);
}

/** Monday-first position in the week: Monday 0 … Sunday 6. */
export function isoIndex(weekday: number): number {
  return (weekday + 6) % 7;
}

/**
 * The first day the rule names strictly AFTER `date`. Weeks run Monday to
 * Sunday: "every 2 weeks on Tuesday and Thursday" takes the rest of this
 * week's days first, then skips a week.
 */
export function stepAfter(
  rule: CalendarRule,
  date: CalendarDate,
): CalendarDate {
  switch (rule.frequency) {
    case 'daily':
      return addDays(date, rule.interval);
    case 'weekly': {
      const today = isoIndex(weekdayOf(date));
      const days = rule.weekdays.map(isoIndex).toSorted((a, b) => a - b);
      const laterThisWeek = days.find((d) => d > today);
      if (laterThisWeek !== undefined) {
        return addDays(date, laterThisWeek - today);
      }
      const monday = addDays(date, -today);
      return addDays(monday, rule.interval * 7 + (days[0] ?? 0));
    }
    case 'monthly': {
      const candidate = clampedDate(date.year, date.month, rule.monthDay);
      return isAfter(candidate, date)
        ? candidate
        : clampedDate(date.year, date.month + rule.interval, rule.monthDay);
    }
    case 'yearly': {
      const candidate = clampedDate(date.year, rule.month, rule.monthDay);
      return isAfter(candidate, date)
        ? candidate
        : clampedDate(date.year + rule.interval, rule.month, rule.monthDay);
    }
  }
}

/**
 * The first day the rule names on or after `from`, its step ignored:
 * "every 2 weeks on Monday" read on a Monday names that Monday, not one a
 * fortnight on. A series starts here and steps from it.
 */
export function firstRuleDay(
  rule: CalendarRule,
  from: CalendarDate,
): CalendarDate {
  return rule.frequency === 'daily'
    ? from
    : stepAfter({ ...rule, interval: 1 }, addDays(from, -1));
}

/** Negative when `a` is the earlier day, zero on the same day. */
export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return toUtc(a) - toUtc(b);
}

/** Whole calendar months from `from`'s month to `to`'s, days ignored:
 * January 31 to February 1 is one. */
export function monthsBetween(from: CalendarDate, to: CalendarDate): number {
  return (to.year - from.year) * 12 + (to.month - from.month);
}

/** The Monday that starts `date`'s week. */
export function mondayOf(date: CalendarDate): CalendarDate {
  return addDays(date, -isoIndex(weekdayOf(date)));
}

/**
 * A `YYYY-MM-DD` day, or null when the text is not one or names a day no
 * calendar has (`2026-02-30`).
 */
export function parseIsoDate(text: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** `YYYY-MM-DD`, zero-padded, for a year from 0 to 9999. */
export function formatIsoDate(date: CalendarDate): string {
  const pad = (value: number, width: number) =>
    String(value).padStart(width, '0');
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}
