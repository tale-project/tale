/**
 * Pure date/interval helpers for the daily task-metrics rollup (no ctx, no
 * Date.now — fully unit-testable). Day keys are UTC `YYYY-MM-DD`, matching
 * the usage/workflow metrics convention.
 */

export const OPEN_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
] as const;

export type OpenStatus = (typeof OPEN_STATUSES)[number];

export type PerOpenStatus = Record<OpenStatus, number>;

export function emptyPerStatus(): PerOpenStatus {
  return { backlog: 0, todo: 0, in_progress: 0, in_review: 0 };
}

export function isOpenStatus(value: string): value is OpenStatus {
  return (OPEN_STATUSES as readonly string[]).includes(value);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** [startMs, endMs) of a UTC day key. Throws on malformed keys. */
export function utcDayRange(dateKey: string): {
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

/** The previous UTC day key relative to `ms` (the cron's default target). */
export function previousUtcDayKey(ms: number): string {
  return utcDayKey(ms - DAY_MS);
}

/** Day key `days` days before `dateKey` (retention pruning cutoffs). */
export function dayKeyDaysBefore(dateKey: string, days: number): string {
  const { startMs } = utcDayRange(dateKey);
  return utcDayKey(startMs - days * DAY_MS);
}

/**
 * Overlap of `[segStartMs, segEndMs)` with `[dayStartMs, dayEndMs)` — the
 * day-clipped dwell contribution of one status segment. Sums stay additive
 * across days because each day only counts its own slice.
 */
export function clipToDay(
  segStartMs: number,
  segEndMs: number,
  dayStartMs: number,
  dayEndMs: number,
): number {
  const start = Math.max(segStartMs, dayStartMs);
  const end = Math.min(segEndMs, dayEndMs);
  return Math.max(0, end - start);
}
