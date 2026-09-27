/**
 * The one cron validator — the five-field parse the `schedule` trigger bind
 * refuses on, shared by the backend matcher (`backend/core/automations/
 * cron.ts`) and the editor's preview (`app/features/automations/lib/
 * cron-preview.ts`), so the panel never previews a "next run" for an
 * expression the save will turn down.
 *
 * Five fields — minute, hour, day-of-month, month, day-of-week — each a `*`,
 * a number, a `a-b` range, a step (`a-b/n`, or a wildcard with a step), or a
 * comma-separated list of those. Names (`MON`, `JAN`), `L`, `W`, `?` and a
 * sixth seconds field are NOT accepted: the matcher that fires the schedule
 * reads none of them, and a preview that accepted them promised a run the
 * bind refused. Day-of-week is 0..7 with both 0 and 7 meaning Sunday,
 * matching what operators expect from crontab.
 *
 * Pure: no `Intl`, no clock — the wall-clock half stays in the backend.
 */

import {
  describeImpossibleCronDate,
  impossibleCronDate,
} from './cron-feasibility.ts';

export interface CronField {
  min: number;
  max: number;
  values: Set<number>;
  /** Whether the field was left unrestricted (`*`) — the day-of-month /
   * day-of-week OR rule needs to know. */
  wildcard: boolean;
}

export function parseField(spec: string, min: number, max: number): CronField {
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
