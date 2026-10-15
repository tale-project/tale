/**
 * What a row's usage cells have to agree on — with each other, and with the
 * row they sit in.
 *
 * A row's plan is drawn twice — how much of each window is spent, and how long
 * that window still has to run — in two table cells that must stay line for
 * line; and the account's state, which the gateway derives from those windows,
 * decides which of the clocks matters. Anything more than one of them decides
 * lives here rather than in any one.
 */

import type { TFunction } from 'i18next';

import type { UsageWindow } from '@/app/lib/api';

/**
 * The windows the panel draws.
 *
 * A window the vendor gave no figure for has nothing to show, so both columns
 * drop it — and they have to drop exactly the same ones, or their rows stop
 * lining up across the table.
 */
export function readableWindows(windows: UsageWindow[]): UsageWindow[] {
  return windows.filter((window) => window.utilization !== null);
}

/**
 * A stable key for a window inside one account's cell.
 *
 * Two scoped windows share a name only if the vendor repeats itself; the
 * index keeps the list keyed either way.
 */
export function windowKey(window: UsageWindow, index: number): string {
  return `${window.kind}-${window.label ?? index}`;
}

/**
 * What to call a window.
 *
 * The two shared kinds are translated; a `scoped` one carries the vendor's own
 * name for what it caps — a model, a metered limit — and is shown verbatim,
 * because inventing our own word for someone else's limit would be a guess.
 */
export function windowName(window: UsageWindow, t: TFunction): string {
  if (window.kind === 'scoped') return window.label ?? '';
  return t(window.kind === 'session' ? 'session' : 'weekly');
}

/** Within this of its rollover, a reset is close enough to point out. */
const RESET_SOON_MS = 60 * 60 * 1000;

/** A rollover as an instant, or NaN when there is none to read. */
function instant(value: string | null): number {
  return value === null ? Number.NaN : Date.parse(value);
}

/**
 * Whether an instant lies within the hour ahead.
 *
 * The one reset worth a second look: a limited account that comes back in
 * twenty minutes is about to be usable again. One already behind `now` is not
 * "soon" — it is past, and the next read replaces the reading.
 */
export function resetsSoon(resetsAt: string | null, now: number): boolean {
  const remaining = instant(resetsAt) - now;
  return (
    Number.isFinite(remaining) && remaining > 0 && remaining < RESET_SOON_MS
  );
}

/** Whether a rollover has come: the figure it belonged to is out of date. */
export function hasRolledOver(resetsAt: string | null, now: number): boolean {
  const rollover = instant(resetsAt);
  return Number.isFinite(rollover) && rollover <= now;
}

/**
 * How one window's rollover bears on the account.
 *
 * - `return`: the account is limited, and this is the clock it waits for —
 *   the spent window that rolls over last.
 * - `waiting`: spent too, but it rolls over before the account is free, so
 *   its clock decides nothing yet.
 * - `running`: not what holds the account back; an ordinary countdown.
 *
 * A session that resets in five minutes beside a spent week is `waiting`, and
 * the week is the `return`: the account is not back in five minutes, and the
 * column says which clock to read.
 */
export type ResetRole = 'return' | 'waiting' | 'running';

export function resetRole(
  window: UsageWindow,
  limitedUntil: string | null,
): ResetRole {
  if (!window.blocking) return 'running';
  // Compared as instants: the account's own return is normalised, a window's
  // is whatever spelling its vendor used.
  const same =
    limitedUntil === null || window.resetsAt === null
      ? limitedUntil === window.resetsAt
      : instant(window.resetsAt) === instant(limitedUntil);
  return same ? 'return' : 'waiting';
}

/**
 * How far through its window the clock already is, 0–100, or null.
 *
 * Measured backwards from the rollover, the only instant either vendor
 * reports, so it also needs the window's own length; without both there is
 * nothing honest to draw and the column shows the remaining time alone.
 */
export function windowElapsedPercent(
  window: UsageWindow,
  now: number,
): number | null {
  const { resetsAt, windowSeconds } = window;
  if (!resetsAt || windowSeconds === null || windowSeconds <= 0) return null;
  const rollover = new Date(resetsAt).getTime();
  if (!Number.isFinite(rollover)) return null;
  const elapsedSeconds = windowSeconds - (rollover - now) / 1000;
  return Math.min(100, Math.max(0, (elapsedSeconds / windowSeconds) * 100));
}
