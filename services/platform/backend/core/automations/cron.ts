/**
 * Minute-resolution cron matching for `schedule` triggers.
 *
 * Five fields — minute, hour, day-of-month, month, day-of-week — each a `*`, a
 * number, a `a-b` range, a step (`a-b/n`, or a wildcard with a step), or a
 * comma-separated list of
 * those. Day-of-week is 0..7 with both 0 and 7 meaning Sunday, matching what
 * operators expect from crontab. When BOTH day-of-month and day-of-week are
 * restricted, a day matching EITHER fires — crontab's own rule, and the one
 * that makes "every Monday and the 1st" express what it reads like.
 *
 * Written here rather than taken from the packaged parser because the package
 * re-exports a crontab-FILE reader, which pulls `node:fs` into a bundle that
 * runs in a runtime with no filesystem. The matcher below is the part a trigger
 * scan actually needs; the parse it matches against is the shared validator in
 * `lib/automations/cron.ts`.
 *
 * Wall-clock time is resolved in the trigger's IANA zone through `Intl`, so a
 * schedule written as 09:00 Europe/Zurich stays 09:00 across a DST change
 * instead of drifting an hour twice a year.
 */

import {
  type CronField,
  type CronSchedule,
  parseCron,
} from '../../../lib/automations/cron.ts';

// The parse itself — `parseField` / `parseCron` — lives in
// `lib/automations/cron.ts`, shared with the editor's preview so both refuse
// the same expressions; this module keeps the wall-clock half.
export { parseCron, type CronField, type CronSchedule };

/** How far back a scan will look for a missed minute. A schedule is a
 * heartbeat, not a queue: after an outage the automation resumes on its next
 * occurrence rather than replaying an hour of them. */
const MAX_CATCHUP_MS = 60 * 60 * 1000;

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

/** Whether one instant falls on an occurrence of the schedule. */
export function cronMatches(
  schedule: CronSchedule,
  at: number,
  timezone: string,
): boolean {
  const clock = wallClockIn(at, timezone);
  if (!matchesField(schedule.minute, clock.minute)) return false;
  if (!matchesField(schedule.hour, clock.hour)) return false;
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

/**
 * The most recent occurrence at or before `now` that is strictly newer than
 * `since`, or null when the schedule is not due. Minutes are scanned backwards
 * from `now`, bounded by {@link MAX_CATCHUP_MS}, so one scan fires an
 * automation at most once however long the scanner was away.
 */
export function dueOccurrence(
  expression: string,
  timezone: string,
  since: number,
  now: number,
): number | null {
  const schedule = parseCron(expression);
  const floor = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  const earliest = Math.max(since, now - MAX_CATCHUP_MS);
  for (let at = floor; at > earliest; at -= MINUTE_MS) {
    if (cronMatches(schedule, at, timezone)) return at;
  }
  return null;
}
