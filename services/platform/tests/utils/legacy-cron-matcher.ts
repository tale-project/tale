/**
 * The minute-by-minute cron matcher the schedule scan fired on before the
 * schedule evaluator (`lib/automations/schedule/occurrences.ts`) replaced
 * it, kept only as the oracle the evaluator's tests hold it to: on ordinary
 * days, and through a repeated hour, both must name the same starts. Nothing
 * outside tests reads it.
 *
 * Five fields — minute, hour, day-of-month, month, day-of-week — each a `*`, a
 * number, a `a-b` range, a step (`a-b/n`, or a wildcard with a step), or a
 * comma-separated list of those. Day-of-week is 0..7 with both 0 and 7
 * meaning Sunday. When BOTH day-of-month and day-of-week are restricted, a day
 * matching EITHER fires — crontab's own rule. Wall-clock time is resolved in
 * the trigger's IANA zone through `Intl`.
 */

import {
  type CronField,
  type CronSchedule,
  parseCron,
} from '../../lib/automations/cron.ts';

// The parse itself lives in `lib/automations/cron.ts`, which the evaluator
// shares; this module keeps the legacy wall-clock half.
export { parseCron, type CronField, type CronSchedule };

const MINUTE_MS = 60 * 1000;

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface WallClock {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

/** One formatter per zone, built on first use. A scan asks for the wall
 * clock of up to sixty minutes per schedule per tick, and `Intl.DateTimeFormat`
 * construction is the expensive half of that — the formatter is stateless,
 * so the same one serves every instant in the zone. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timezone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  });
  formatters.set(timezone, formatter);
  return formatter;
}

/** The wall-clock parts of an instant in one IANA zone. An unknown zone is a
 * configuration error the caller reports, so it throws rather than silently
 * falling back to UTC and firing at the wrong hour. */
export function wallClockIn(at: number, timezone: string): WallClock {
  const parts = formatterFor(timezone).formatToParts(new Date(at));
  const read = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  // `hour12: false` renders midnight as "24" in some ICU versions; normalize.
  const hour = Number(read('hour')) % 24;
  return {
    minute: Number(read('minute')),
    hour,
    dayOfMonth: Number(read('day')),
    month: Number(read('month')),
    dayOfWeek: WEEKDAYS[read('weekday')] ?? 0,
  };
}

function matchesField(field: CronField, value: number): boolean {
  return field.values.has(value);
}

/** Whether the local day of `clock` is one the schedule runs on: its month,
 * and crontab's day rule over day-of-month and day-of-week. */
function dayMatches(schedule: CronSchedule, clock: WallClock): boolean {
  if (!matchesField(schedule.month, clock.month)) return false;
  const dayOfWeek =
    matchesField(schedule.dayOfWeek, clock.dayOfWeek) ||
    (clock.dayOfWeek === 0 && matchesField(schedule.dayOfWeek, 7));
  const dayOfMonth = matchesField(schedule.dayOfMonth, clock.dayOfMonth);
  // crontab's day rule: restricting both means "either", restricting one means
  // that one, restricting neither means every day.
  if (schedule.dayOfMonth.wildcard && schedule.dayOfWeek.wildcard) return true;
  if (schedule.dayOfMonth.wildcard) return dayOfWeek;
  if (schedule.dayOfWeek.wildcard) return dayOfMonth;
  return dayOfMonth || dayOfWeek;
}

/** Whether one instant falls on an occurrence of the schedule. */
export function cronMatches(
  schedule: CronSchedule,
  at: number,
  timezone: string,
): boolean {
  const clock = wallClockIn(at, timezone);
  if (!matchesField(schedule.minute, clock.minute)) return false;
  if (!matchesField(schedule.hour, clock.hour)) return false;
  return dayMatches(schedule, clock);
}

/**
 * The first minute after `from`, and no later than `until`, on which the
 * scan fires the schedule in `timezone` — the minute `cronMatches` accepts,
 * found without testing every minute: a local hour the hour or day fields
 * refuse is skipped to its end. The editor's next-run preview asks this, so
 * the time it shows is the scan's own, daylight-saving changes included.
 * Null when no occurrence falls in the window.
 */
export function firstOccurrenceBetween(
  schedule: CronSchedule,
  timezone: string,
  from: number,
  until: number,
): number | null {
  let at = Math.floor(from / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  while (at <= until) {
    const clock = wallClockIn(at, timezone);
    if (
      !matchesField(schedule.hour, clock.hour) ||
      !dayMatches(schedule, clock)
    ) {
      at += (60 - clock.minute) * MINUTE_MS;
      continue;
    }
    if (matchesField(schedule.minute, clock.minute)) return at;
    at += MINUTE_MS;
  }
  return null;
}
