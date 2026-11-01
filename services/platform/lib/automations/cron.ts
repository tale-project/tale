/**
 * The one cron validator — the five-field parse the `schedule` trigger bind
 * refuses on, shared by the schedule evaluator
 * (`lib/automations/schedule/occurrences.ts`) and the trigger editor's Cron
 * field, so the panel never previews a "next run" for an expression the
 * save will turn down.
 *
 * Five fields — minute, hour, day-of-month, month, day-of-week — each a `*`,
 * a number, a `a-b` range, a step (`a-b/n`, or a wildcard with a step), or a
 * comma-separated list of those. Names (`MON`, `JAN`), `L`, `W`, `?` and a
 * sixth seconds field are NOT accepted: the matcher that fires the schedule
 * reads none of them, and a preview that accepted them promised a run the
 * bind refused. Day-of-week is 0..7 with both 0 and 7 meaning Sunday,
 * matching what operators expect from crontab.
 *
 * A refusal is a `CronParseError`: its `problem` names what is wrong as
 * facts, which the editors word in the author's language
 * (`app/features/automations/lib/cron-problem-text.ts`), and its message is
 * the English sentence the bind's refusal carries to the REST API and the
 * CLI.
 *
 * Pure: no `Intl`, no clock — the wall-clock half is the evaluator's.
 */

import {
  describeImpossibleCronDate,
  type ImpossibleCronDate,
  impossibleCronDate,
} from './cron-feasibility.ts';

export interface CronField {
  min: number;
  max: number;
  values: Set<number>;
  /** Whether the field was left unrestricted (`*`) — the day-of-month /
   * day-of-week OR rule needs to know. */
  wildcard: boolean;
  /** Whether the field's text starts with `*`, a bare one or one with a
   * step — what makes a minute or hour field a wildcard in Vixie cron's
   * daylight-saving rule, and so the expression a grid
   * ({@link cronDstClass}). */
  starred: boolean;
}

/** What keeps an expression from parsing, as the facts its sentence needs:
 * the text as written (`token`), the field it stands in, the values that
 * field takes. */
export type CronProblem =
  | { kind: 'field_count'; count: number }
  // A comma with nothing on one side: `1,,2`, `1,`.
  | { kind: 'empty_entry'; field: CronFieldName; token: string }
  | { kind: 'invalid_step'; field: CronFieldName; token: string }
  | { kind: 'not_a_range'; field: CronFieldName; token: string }
  // No whole number in the field's range, or a range that runs backwards.
  | {
      kind: 'out_of_range';
      field: CronFieldName;
      token: string;
      min: number;
      max: number;
    }
  | { kind: 'matches_nothing'; field: CronFieldName; token: string }
  | ({ kind: 'impossible_date' } & ImpossibleCronDate);

export type CronProblemKind = CronProblem['kind'];

/** An expression the parse refuses: `problem` for the reader's language,
 * `message` in English for the bind's refusal. */
export class CronParseError extends Error {
  readonly problem: CronProblem;

  constructor(problem: CronProblem, message: string) {
    super(message);
    this.name = 'CronParseError';
    this.problem = problem;
  }
}

export function parseField(
  spec: string,
  min: number,
  max: number,
  field: CronFieldName,
): CronField {
  const values = new Set<number>();
  let wildcard = false;
  for (const part of spec.split(',')) {
    const piece = part.trim();
    if (piece === '') {
      throw new CronParseError(
        { kind: 'empty_entry', field, token: spec },
        `empty field in "${spec}"`,
      );
    }
    const [rangeText, stepText] = piece.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) {
      throw new CronParseError(
        { kind: 'invalid_step', field, token: piece },
        `invalid step in "${piece}"`,
      );
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
        throw new CronParseError(
          { kind: 'not_a_range', field, token: piece },
          `"${piece}" is not a range — write it as "from-to"`,
        );
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
      throw new CronParseError(
        { kind: 'out_of_range', field, token: piece, min, max },
        `"${piece}" is out of range (${min}..${max})`,
      );
    }
    for (let value = from; value <= to; value += step) values.add(value);
  }
  if (values.size === 0) {
    throw new CronParseError(
      { kind: 'matches_nothing', field, token: spec },
      `"${spec}" matches nothing`,
    );
  }
  return { min, max, values, wildcard, starred: spec.trim().startsWith('*') };
}

export interface CronSchedule {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

export type CronFieldName = keyof CronSchedule;

/** A cron expression whose fields are each in range but whose days never
 * meet (`0 0 30 2 *`): readable, and still never due. */
export class CronImpossibleDateError extends CronParseError {
  constructor(impossible: ImpossibleCronDate) {
    super(
      { kind: 'impossible_date', ...impossible },
      describeImpossibleCronDate(impossible),
    );
    this.name = 'CronImpossibleDateError';
  }
}

/** Parse a five-field expression. Throws a `CronParseError` naming the
 * offending text — the caller turns that into a refusal the author can act
 * on. */
export function parseCron(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new CronParseError(
      { kind: 'field_count', count: fields.length },
      `a cron expression has 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}: "${expression}"`,
    );
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const schedule: CronSchedule = {
    minute: parseField(minute, 0, 59, 'minute'),
    hour: parseField(hour, 0, 23, 'hour'),
    dayOfMonth: parseField(dayOfMonth, 1, 31, 'dayOfMonth'),
    month: parseField(month, 1, 12, 'month'),
    dayOfWeek: parseField(dayOfWeek, 0, 7, 'dayOfWeek'),
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
  if (impossible !== null) throw new CronImpossibleDateError(impossible);
  return schedule;
}

/** What keeps an expression from parsing, or null when it parses. */
export function cronParseProblem(expression: string): CronProblem | null {
  try {
    parseCron(expression);
    return null;
  } catch (error) {
    if (error instanceof CronParseError) return error.problem;
    throw error;
  }
}

/**
 * How an expression behaves when the clock changes. `named` — both minute
 * and hour spelled out (`30 2 * * *`) — names times of day: one that does not
 * exist that day moves forward by the gap, and one that occurs twice starts
 * once, at its first instant. `grid` — the minute or the hour starts with `*`
 * (every 15 minutes, `30 * * * *`) — keeps its pace in real time: it starts at
 * every instant whose wall clock is on it, so a repeated hour runs twice and
 * a skipped one not at all. Vixie cron and cronie draw the same line, and a
 * schedule's repeat rule falls on the same sides (day rules named, minutely
 * and hourly grids), so converting between the two changes nothing.
 */
export function cronDstClass(schedule: CronSchedule): 'grid' | 'named' {
  return schedule.minute.starred || schedule.hour.starred ? 'grid' : 'named';
}
