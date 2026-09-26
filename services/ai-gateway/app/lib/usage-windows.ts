/**
 * What a row's usage cells have to agree on — with each other, and with the
 * row they sit in.
 *
 * A row's plan is drawn twice — how much of each window is spent, and how long
 * that window still has to run — in two table cells that must stay line for
 * line; and a plan that is spent greys the whole row. Anything more than one
 * of them decides lives here rather than in any one.
 */

import type { TFunction } from 'i18next';

import type { UsageWindow } from '@/app/lib/api';
import { isSpent, spentPercent } from '@/app/lib/usage-tint';

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
 * Whether an account's reading says its plan is used up for now: its session
 * or its weekly window stands at the ceiling.
 *
 * Only those two stop the account as a whole. A scoped window caps one model,
 * and the account still answers for every other one — so a spent per-model
 * week leaves its row alone. The figure is the one the bar prints, rounded
 * down against the same ceiling, so a row reads as spent exactly when one of
 * those two bars is red.
 */
export function planSpent(windows: UsageWindow[]): boolean {
  return readableWindows(windows).some(
    (window) =>
      window.kind !== 'scoped' && isSpent(spentPercent(window.utilization)),
  );
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

/** Within this of its rollover, a window's reset is close enough to point out. */
const RESET_SOON_MS = 60 * 60 * 1000;

/**
 * Whether a window rolls over within the hour.
 *
 * The one reset worth a second look: a spent window that comes back in twenty
 * minutes is an account about to be usable again. A rollover already behind
 * `now` is not "soon" — the reading predates it, and the next read replaces
 * it.
 */
export function resetsSoon(window: UsageWindow, now: number): boolean {
  if (!window.resetsAt) return false;
  const remaining = new Date(window.resetsAt).getTime() - now;
  return (
    Number.isFinite(remaining) && remaining > 0 && remaining < RESET_SOON_MS
  );
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
