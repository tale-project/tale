/**
 * Local wall-clock time in an IANA zone, through `Intl` alone — the half of
 * a schedule that turns "09:30 on 2026-03-29 in Europe/Zurich" into an
 * instant, and an instant back into the local day and time it shows.
 *
 * A local time can name no instant (it falls in the gap a clock skips
 * forward over) or two (it falls in the hour a clock repeats). The resolver
 * follows Temporal's `GetPossibleEpochNanoseconds` with
 * `disambiguation: 'compatible'`, which is also RFC 5545's rule for a named
 * time: read the zone's offsets one day before and one day after, keep each
 * `local − offset` whose wall clock really is `local`, take the earliest; and
 * when none is left the time is in a gap, so it moves forward by the gap
 * (`local − offset before`). Day.js and Luxon pick the later instant of a
 * repeated hour in a few zones (Casablanca, Mexico City, Fiji, …); this
 * resolver agrees with a brute-force scan of every instant in all of them
 * (`zoned-time.test.ts`). When Temporal ships in Bun and Node,
 * `Temporal.ZonedDateTime` replaces this module and its tests stay.
 *
 * Pure: no clock is read except by `localTimeZone()`, and the app and the
 * backend import the same functions.
 */

import { type CalendarDate, weekdayOf } from './calendar.ts';

const SECOND_MS = 1000;
const DAY_MS = 86_400_000;

/** What a clock on the wall shows at one instant in one zone. */
export interface WallClock extends CalendarDate {
  hour: number;
  minute: number;
  second: number;
  /** `Date#getDay`: 0 is Sunday. */
  weekday: number;
}

/** A time of day on a 24-hour clock. */
export interface ClockTime {
  hour: number;
  minute: number;
}

type DatePart = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second';

const DATE_PARTS: readonly DatePart[] = [
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
];

function isDatePart(type: string): type is DatePart {
  return (DATE_PARTS as readonly string[]).includes(type);
}

interface ZoneReader {
  formatter: Intl.DateTimeFormat;
  /** Where each number sits in the formatter's output, read once from
   * `formatToParts`, so the cheaper `format` can be split by position. */
  position: Record<DatePart, number>;
}

/** One reader per zone, built on first use: constructing an
 * `Intl.DateTimeFormat` is the expensive half, and the formatter is
 * stateless. `format` plus a split is about four times faster than
 * `formatToParts` in Node, and an occurrence walk reads many instants. */
const readers = new Map<string, ZoneReader>();

function readerFor(timeZone: string): ZoneReader {
  const cached = readers.get(timeZone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const order = formatter
    .formatToParts(0)
    .map((part) => part.type)
    .filter(isDatePart);
  const position: Record<DatePart, number> = {
    year: order.indexOf('year'),
    month: order.indexOf('month'),
    day: order.indexOf('day'),
    hour: order.indexOf('hour'),
    minute: order.indexOf('minute'),
    second: order.indexOf('second'),
  };
  const reader = { formatter, position };
  readers.set(timeZone, reader);
  return reader;
}

function clockFromParts(
  read: (part: DatePart) => number,
): Omit<WallClock, 'weekday'> {
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // An ICU that still writes midnight as "24" under h23 reads as 0.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/**
 * The wall clock at `ms` in `timeZone`. An unknown zone throws (a
 * `RangeError` from `Intl`): the caller validated it, and firing at a UTC
 * guess would be worse than a refusal.
 */
export function wallClockIn(ms: number, timeZone: string): WallClock {
  const reader = readerFor(timeZone);
  const numbers = reader.formatter.format(ms).match(/\d+/g);
  let clock: Omit<WallClock, 'weekday'>;
  if (numbers !== null && numbers.length === DATE_PARTS.length) {
    clock = clockFromParts((part) =>
      Number(numbers[reader.position[part]] ?? 0),
    );
  } else {
    // A rendering the split cannot read (an era, a numbering system with
    // other digits): the named parts are slower and always right.
    const parts = reader.formatter.formatToParts(ms);
    clock = clockFromParts((part) =>
      Number(parts.find((p) => p.type === part)?.value ?? 0),
    );
  }
  return { ...clock, weekday: weekdayOf(clock) };
}

/** Epoch ms of a wall-clock reading taken as if it were UTC. */
function asUtc(
  date: CalendarDate,
  hour: number,
  minute: number,
  second = 0,
): number {
  const ms = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    hour,
    minute,
    second,
  );
  if (date.year >= 100 || date.year < 0) return ms;
  // `Date.UTC` reads the years 0–99 as 1900–1999.
  const utc = new Date(ms);
  utc.setUTCFullYear(date.year);
  return utc.getTime();
}

/** How far `timeZone`'s wall clock is ahead of UTC at `ms`, in ms (negative
 * west of Greenwich). Historic offsets with seconds are kept exactly. */
export function offsetAt(ms: number, timeZone: string): number {
  const whole = Math.floor(ms / SECOND_MS) * SECOND_MS;
  const clock = wallClockIn(whole, timeZone);
  return asUtc(clock, clock.hour, clock.minute, clock.second) - whole;
}

/** The calendar day `ms` falls on in `timeZone`. */
export function localDateIn(ms: number, timeZone: string): CalendarDate {
  const { year, month, day } = wallClockIn(ms, timeZone);
  return { year, month, day };
}

interface Resolution {
  /** Every instant showing the local time, earliest first. */
  candidates: number[];
  /** The local time read as if it were UTC. */
  local: number;
  /** The zone's offset one day before it. */
  before: number;
}

function resolve(
  date: CalendarDate,
  time: ClockTime,
  timeZone: string,
): Resolution {
  const local = asUtc(date, time.hour, time.minute);
  const before = offsetAt(local - DAY_MS, timeZone);
  const after = offsetAt(local + DAY_MS, timeZone);
  const candidates: number[] = [];
  for (const offset of before === after ? [before] : [before, after]) {
    const at = local - offset;
    // `at` shows `local` exactly when the zone's offset there is the one
    // the candidate was built from.
    if (offsetAt(at, timeZone) === offset) candidates.push(at);
  }
  candidates.sort((a, b) => a - b);
  return { candidates, local, before };
}

/**
 * Every instant whose wall clock in `timeZone` reads `time` on `date`, in
 * order: none when the time falls in a gap, two when it falls in a repeated
 * hour, one otherwise.
 */
export function zonedCandidates(
  date: CalendarDate,
  time: ClockTime,
  timeZone: string,
): number[] {
  return resolve(date, time, timeZone).candidates;
}

/**
 * The instant `time` on `date` names in `timeZone`, resolved the compatible
 * way: a repeated time is its first instant, and a time the clock skipped
 * moves forward by the length of the gap (02:30 on a 02:00 → 03:00 night is
 * 03:30).
 */
export function zonedInstant(
  date: CalendarDate,
  time: ClockTime,
  timeZone: string,
): number {
  const { candidates, local, before } = resolve(date, time, timeZone);
  return candidates[0] ?? local - before;
}

/** Whether `Intl` resolves `value` as a zone: IANA names (any case) and
 * fixed offsets such as `+05:30`. The text is taken as written — a padded
 * name is not one. */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

/**
 * The zone `value` names, trimmed and spelled the way `Intl` spells it
 * (`utc` → `UTC`, `europe/zurich` → `Europe/Zurich`), or null when it names
 * none — a blank value included. Runtimes differ on links: Bun keeps
 * `US/Eastern` where Node answers `America/New_York`; both are valid
 * everywhere.
 */
export function canonicalTimeZone(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: trimmed,
    }).resolvedOptions().timeZone;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** The zone this runtime reads dates in — the browser's, in the app. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
