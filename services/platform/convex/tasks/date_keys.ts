/**
 * Pure UTC day-key helpers for task metrics windows — no Convex exports.
 *
 * Relocated from the retired `convex/legacy/task_metrics_queries.ts` (itself
 * a copy of the retired `task_metrics/rollup_math.ts` date helpers) when the
 * 0.4 baseline reset dropped the `taskMetricsDaily` rollup table. The math is
 * table-agnostic: day keys are `YYYY-MM-DD` in UTC, windows are half-open
 * `[startKey, todayKey]` ranges — the vocabulary any future rollup rebuild
 * (and its period-over-period deltas) speaks.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const TREND_MAX_DAYS = 90;

/** UTC day key (`YYYY-MM-DD`) of a millisecond timestamp. */
export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** [startMs, endMs) of a UTC day key. Throws on malformed keys. */
function utcDayRange(dateKey: string): {
  startMs: number;
  endMs: number;
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`invalid dateKey "${dateKey}" (expected YYYY-MM-DD)`);
  }
  const startMs = Date.parse(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(startMs)) {
    throw new Error(`invalid dateKey "${dateKey}"`);
  }
  return { startMs, endMs: startMs + DAY_MS };
}

/** Day key `days` days before `dateKey` (retention pruning cutoffs). */
function dayKeyDaysBefore(dateKey: string, days: number): string {
  const { startMs } = utcDayRange(dateKey);
  return utcDayKey(startMs - days * DAY_MS);
}

/** Day-key bounds of a trailing window of `days` days (clamped to 1–90). */
export function windowKeys(days: number): {
  startKey: string;
  /** Start of the immediately-preceding equal-length window (for deltas). */
  prevStartKey: string;
  todayKey: string;
} {
  const clamped = Math.min(Math.max(days, 1), TREND_MAX_DAYS);
  const todayKey = utcDayKey(Date.now());
  return {
    startKey: dayKeyDaysBefore(todayKey, clamped),
    prevStartKey: dayKeyDaysBefore(todayKey, clamped * 2),
    todayKey,
  };
}
