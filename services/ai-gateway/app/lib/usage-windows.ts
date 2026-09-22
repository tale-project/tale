/**
 * What two columns have to agree on.
 *
 * A row's plan is drawn twice — how much of each window is spent, and how long
 * that window still has to run — in two table cells that must stay line for
 * line. Anything both of them decide lives here rather than in either one.
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
