/**
 * Parse the Executions date-range filter strings into inclusive epoch-ms bounds.
 *
 * The Executions filter serializes the picker's selection as ISO instants: the
 * start of the `from` day and the END of the `to` day (see executions-table's
 * `handleDateRangeChange`). Parsing those instants directly yields a correct,
 * timezone-consistent, fully-inclusive range when compared with the numeric
 * `startedAt` epoch via `.gte`/`.lte`.
 *
 * For backward compatibility with older links that serialized a bare calendar
 * date (`YYYY-MM-DD`), a date-only `dateTo` is expanded to the last millisecond
 * of that UTC day. Without this, `new Date('2026-06-24').getTime()` collapses to
 * UTC midnight, so every run later than 00:00 UTC on the end day fails the
 * `.lte` predicate and the entire end day is excluded — issue #2075.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface ExecutionDateBounds {
  fromDate: number | undefined;
  toDate: number | undefined;
}

function parseInstant(value: string): number | undefined {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

export function parseExecutionDateBounds(
  dateFrom?: string,
  dateTo?: string,
): ExecutionDateBounds {
  const fromDate = dateFrom ? parseInstant(dateFrom) : undefined;

  let toDate = dateTo ? parseInstant(dateTo) : undefined;
  // A bare YYYY-MM-DD parses to UTC midnight; treat it as the whole UTC day so
  // the end day stays inclusive (legacy URL compatibility — issue #2075).
  if (toDate !== undefined && dateTo && DATE_ONLY.test(dateTo)) {
    toDate += DAY_MS - 1;
  }

  return { fromDate, toDate };
}
