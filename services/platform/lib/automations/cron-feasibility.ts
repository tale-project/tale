/**
 * The one rule that decides whether a cron expression's day-of-month can
 * ever meet its month — shared by the backend matcher (`backend/core/
 * automations/cron.ts`, which refuses the expression at bind) and the
 * editor's preview (`app/features/automations/lib/cron-preview.ts`), so the
 * two never disagree about `0 0 31 4,6 *`.
 *
 * Pure and dependency-free on purpose: the app bundle and the worker both
 * import it. Field VALUES are the caller's parser's job; this module only
 * asks whether some (month, day) pair the expression names exists.
 *
 * crontab's day rule applies: when day-of-week is restricted too, a day
 * matching EITHER fires, so `0 0 30 2 1` (the 30th, or Mondays, in
 * February) fires on February's Mondays and is feasible. Only an expression
 * whose day-of-week is a wildcard depends on the day-of-month alone.
 */

/** Days each month can have — February counts its leap day, so `29 2` is a
 * schedule that fires every fourth year rather than never. */
const DAYS_IN_MONTH: readonly number[] = [
  31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
];

export interface CronDayFields {
  /** The day-of-month values the expression names (1..31). */
  dayOfMonth: readonly number[];
  /** Whether day-of-month was left unrestricted (`*`). */
  dayOfMonthWildcard: boolean;
  /** The month values the expression names (1..12). */
  month: readonly number[];
  /** Whether day-of-week was left unrestricted (`*`). */
  dayOfWeekWildcard: boolean;
}

/** The day-of-month × month combination an expression names that no
 * calendar has: every day it restricts to, and every month it restricts to
 * — none of the pairs exists. */
export interface ImpossibleCronDate {
  days: number[];
  months: number[];
}

/** Whether the expression's day fields can ever meet. Null when they can;
 * otherwise the days and months that never combine, for the refusal. */
export function impossibleCronDate(
  fields: CronDayFields,
): ImpossibleCronDate | null {
  if (fields.dayOfMonthWildcard || !fields.dayOfWeekWildcard) return null;
  const months = [...new Set(fields.month)].sort((a, b) => a - b);
  const days = [...new Set(fields.dayOfMonth)].sort((a, b) => a - b);
  const feasible = days.some((day) =>
    months.some((month) => day <= (DAYS_IN_MONTH[month - 1] ?? 0)),
  );
  return feasible ? null : { days, months };
}

/** The sentence a refusal carries: "day-of-month 30 never occurs in month
 * 2", "day-of-month 31 never occurs in months 4, 6, 9, 11". */
export function describeImpossibleCronDate(
  impossible: ImpossibleCronDate,
): string {
  const month = impossible.months.length === 1 ? 'month' : 'months';
  return `day-of-month ${impossible.days.join(', ')} never occurs in ${month} ${impossible.months.join(', ')}`;
}
