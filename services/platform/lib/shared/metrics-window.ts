/**
 * UTC day-bucket helpers for the read-time metrics scans (automation runs,
 * chat health, guardrail events). One source so every metrics surface buckets
 * a timestamp into the same `YYYY-MM-DD` key and pre-seeds the same day
 * window — a second copy of this math is how two charts drift apart.
 *
 * Pure module: no Node, no Convex, no React imports — safe in both the V8
 * Convex runtime and the browser bundle.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC `YYYY-MM-DD` bucket key for a timestamp. */
export function utcDateKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Start of the UTC day containing `ts`. */
export function utcDayStart(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** The window's day keys, oldest first — one per day, today included. */
export function dailyKeys(periodDays: number, now: number): string[] {
  const todayStart = utcDayStart(now);
  const keys: string[] = [];
  for (let i = periodDays - 1; i >= 0; i--) {
    keys.push(utcDateKey(todayStart - i * DAY_MS));
  }
  return keys;
}
