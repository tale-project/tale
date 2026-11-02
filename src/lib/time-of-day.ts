/**
 * A time of day on the wall clock — "9:30 AM", "21:30" — as the time field
 * and the schedule picker read and write it.
 *
 * Pure and zone free: a time of day names a clock reading, never an
 * instant, so every `Intl` call here formats a fixed UTC date and only its
 * hour and minute are read. Whether a locale writes 12 or 24 hours, where it
 * puts the day period and what it calls it, all come from `Intl` in the
 * reader's locale, so no catalog carries them.
 */

/** A wall-clock reading: `hour` 0–23, `minute` 0–59. */
export interface TimeOfDay {
  hour: number;
  minute: number;
}

/** How hours are counted: 1–12 with a day period, or 0–23. */
export type HourCycle = 12 | 24;

/** One part of a time as a field lays it out. */
export type TimeSegment = 'hour' | 'minute' | 'dayPeriod';

/** January 1, 2000, UTC midnight: a time of day is this plus its minutes. */
const BASE_UTC = Date.UTC(2000, 0, 1);
const MINUTE_MS = 60_000;

function instantOf(time: TimeOfDay): number {
  return BASE_UTC + (time.hour * 60 + time.minute) * MINUTE_MS;
}

function intlHourCycle(cycle: HourCycle): 'h12' | 'h23' {
  return cycle === 12 ? 'h12' : 'h23';
}

/** The hour cycle a locale writes times in: English 12, German and French 24. */
export function localHourCycle(locale: string): HourCycle {
  const options = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
  }).resolvedOptions();
  if (options.hourCycle !== undefined) {
    return options.hourCycle === 'h11' || options.hourCycle === 'h12' ? 12 : 24;
  }
  return options.hour12 === true ? 12 : 24;
}

/** The time as the locale writes it — "9:30 AM", "09:30". */
export function formatTimeOfDay(
  time: TimeOfDay,
  locale: string,
  cycle: HourCycle = localHourCycle(locale),
): string {
  return new Intl.DateTimeFormat(locale, {
    timeStyle: 'short',
    hourCycle: intlHourCycle(cycle),
    timeZone: 'UTC',
  }).format(instantOf(clampTime(time)));
}

/** An hour on its own — "9 PM", "21 Uhr", "21 h" — the hour field's
 *  spoken value. */
export function formatHourOnly(
  hour: number,
  locale: string,
  cycle: HourCycle = localHourCycle(locale),
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hourCycle: intlHourCycle(cycle),
    timeZone: 'UTC',
  }).format(instantOf(clampTime({ hour, minute: 0 })));
}

function partsOf(locale: string, cycle: HourCycle, time: TimeOfDay) {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: intlHourCycle(cycle),
    timeZone: 'UTC',
  }).formatToParts(instantOf(time));
}

/** The locale's words for the two halves of a 12-hour day — "AM", "PM". */
export function dayPeriodLabels(locale: string): { am: string; pm: string } {
  const label = (hour: number, fallback: string) =>
    partsOf(locale, 12, { hour, minute: 0 }).find(
      (part) => part.type === 'dayPeriod',
    )?.value ?? fallback;
  return { am: label(9, 'AM'), pm: label(21, 'PM') };
}

/** The order the locale writes a time's parts in; the day period only on a
 *  12-hour clock. */
export function timeSegmentsOrder(
  locale: string,
  cycle: HourCycle,
): TimeSegment[] {
  const order: TimeSegment[] = [];
  for (const part of partsOf(locale, cycle, { hour: 21, minute: 30 })) {
    if (
      (part.type === 'hour' ||
        part.type === 'minute' ||
        part.type === 'dayPeriod') &&
      !order.includes(part.type)
    ) {
      order.push(part.type);
    }
  }
  for (const segment of ['hour', 'minute'] as const) {
    if (!order.includes(segment)) order.push(segment);
  }
  if (cycle === 12 && !order.includes('dayPeriod')) order.push('dayPeriod');
  return cycle === 12 ? order : order.filter((part) => part !== 'dayPeriod');
}

/** What the locale writes between the hour and the minute — ":" in most,
 *  "." in some. */
export function timeSeparator(locale: string): string {
  const parts = partsOf(locale, 24, { hour: 21, minute: 30 });
  const hour = parts.findIndex((part) => part.type === 'hour');
  const minute = parts.findIndex((part) => part.type === 'minute');
  if (hour === -1 || minute === -1 || Math.abs(hour - minute) !== 2) {
    return ':';
  }
  const between = parts[Math.min(hour, minute) + 1]?.value.trim();
  return between === undefined || between === '' ? ':' : between;
}

/** `hour` 0–23 and `minute` 0–59, whole numbers. */
export function clampTime(time: TimeOfDay): TimeOfDay {
  const whole = (value: number, max: number) =>
    Number.isFinite(value) ? Math.min(max, Math.max(0, Math.trunc(value))) : 0;
  return { hour: whole(time.hour, 23), minute: whole(time.minute, 59) };
}

/** Negative when `a` comes first in the day, positive when `b` does. */
export function compareTime(a: TimeOfDay, b: TimeOfDay): number {
  return a.hour * 60 + a.minute - (b.hour * 60 + b.minute);
}

export function sameTime(a: TimeOfDay, b: TimeOfDay): boolean {
  return a.hour === b.hour && a.minute === b.minute;
}

/** `9`, `09`, `930`, `0930`, `9:30`, `9.30`, `9h30`, `9 h 30`, each with an
 *  optional `am`/`pm` (`a.m.`/`p.m.`) after it. */
const TIME_TEXT =
  /^(\d{1,2})(?:\s*(?::|\.|h)\s*(\d{2})?|(\d{2}))?\s*(?:([ap])\.?\s*m\.?)?$/i;

/**
 * A time someone pasted or typed in one go, or null when it is not one. A
 * day period turns a 12-hour reading into the day's hour ("9 pm" is 21:00);
 * without one the hour is read on a 24-hour clock.
 */
export function parseTimeText(text: string): TimeOfDay | null {
  const match = TIME_TEXT.exec(text.trim());
  if (match === null) return null;
  const [, hourText, separatedMinute, packedMinute, period] = match;
  if (hourText === undefined) return null;
  let hour = Number(hourText);
  const minuteText = separatedMinute ?? packedMinute;
  const minute = minuteText === undefined ? 0 : Number(minuteText);
  if (minute > 59) return null;
  if (period !== undefined) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (period.toLowerCase() === 'p' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}
