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
 * scan actually needs.
 *
 * Wall-clock time is resolved in the trigger's IANA zone through `Intl`, so a
 * schedule written as 09:00 Europe/Zurich stays 09:00 across a DST change
 * instead of drifting an hour twice a year.
 */

import {
  describeImpossibleCronDate,
  impossibleCronDate,
} from '../../../lib/automations/cron-feasibility.ts';

/** How far back a scan will look for a missed minute. A schedule is a
 * heartbeat, not a queue: after an outage the automation resumes on its next
 * occurrence rather than replaying an hour of them. */
const MAX_CATCHUP_MS = 60 * 60 * 1000;

const MINUTE_MS = 60 * 1000;

interface CronField {
  min: number;
  max: number;
  values: Set<number>;
  /** Whether the field was left unrestricted (`*`) — the day-of-month /
   * day-of-week OR rule needs to know. */
  wildcard: boolean;
}

function parseField(spec: string, min: number, max: number): CronField {
  const values = new Set<number>();
  let wildcard = false;
  for (const part of spec.split(',')) {
    const piece = part.trim();
    if (piece === '') throw new Error(`empty field in "${spec}"`);
    const [rangeText, stepText] = piece.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`invalid step in "${piece}"`);
    }
    let from: number;
    let to: number;
    if (rangeText === '*') {
      wildcard = wildcard || step === 1;
      from = min;
      to = max;
    } else if (rangeText.includes('-')) {
      // Both ends spelled out: `Number('')` is 0, so `-5` used to read as
      // `0-5` and `5-` as `5-0` — a range with an end missing is refused
      // as what it is, not silently widened to the field's floor.
      const ends = rangeText.split('-');
      const [a, b] = ends;
      if (
        ends.length !== 2 ||
        a === '' ||
        b === '' ||
        a === undefined ||
        b === undefined
      ) {
        throw new Error(`"${piece}" is not a range — write it as "from-to"`);
      }
      from = Number(a);
      to = Number(b);
    } else {
      from = Number(rangeText);
      to = from;
    }
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < min ||
      to > max ||
      from > to
    ) {
      throw new Error(`"${piece}" is out of range (${min}..${max})`);
    }
    for (let value = from; value <= to; value += step) values.add(value);
  }
  if (values.size === 0) throw new Error(`"${spec}" matches nothing`);
  return { min, max, values, wildcard };
}

export interface CronSchedule {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

/** Parse a five-field expression. Throws with the offending text — the caller
 * turns that into a refusal the author can act on. */
export function parseCron(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `a cron expression has 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}: "${expression}"`,
    );
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const schedule: CronSchedule = {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    dayOfMonth: parseField(dayOfMonth, 1, 31),
    month: parseField(month, 1, 12),
    dayOfWeek: parseField(dayOfWeek, 0, 7),
  };
  // Every field in range is not yet a date that exists: `0 0 30 2 *` passed
  // the range checks and matched no minute, ever — the bind answered 200
  // and the schedule silently never fired. The rule is shared with the
  // editor's preview so both refuse the same expressions.
  const impossible = impossibleCronDate({
    dayOfMonth: [...schedule.dayOfMonth.values],
    dayOfMonthWildcard: schedule.dayOfMonth.wildcard,
    month: [...schedule.month.values],
    dayOfWeekWildcard: schedule.dayOfWeek.wildcard,
  });
  if (impossible !== null) {
    throw new Error(describeImpossibleCronDate(impossible));
  }
  return schedule;
}

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
