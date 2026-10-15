/**
 * What an account is right now, in one word — and, when its quota is spent,
 * until when.
 *
 * The panel groups and words its rows from this, and the REST API hands the
 * same verdict to a script, so the two cannot disagree about which accounts
 * are limited or when they come back. It is a pure function of the stored
 * reading and a clock: nothing is persisted, so no document written by an
 * older release needs to change.
 *
 * Deliberately not `quotaAvailability()` in `accounts.ts`, which answers a
 * different question — may this account take NEW work — for the token
 * endpoints, and so also distrusts a reading older than fifteen minutes and
 * weighs the refresh floor. This describes the account as its own latest
 * reading shows it, which is what a person looking at the figures expects the
 * row to say; the two share the rule that matters, that only the session and
 * weekly windows stop an account and that a rollover already behind `now`
 * stops nothing.
 */

import type { UsageWindow } from './providers/types';

/**
 * `available` — can take work, as far as its reading says.
 * `limited` — its session or weekly window is spent; it comes back when
 * every spent window has rolled over.
 * `expired` / `error` — the credential needs attention first, whatever the
 * quota reads: a refresh was refused, or the latest call failed.
 */
export type AccountState = 'available' | 'limited' | 'expired' | 'error';

/** The order a pool reads best to worst; the panel sorts on it. */
export const ACCOUNT_STATES: readonly AccountState[] = [
  'available',
  'limited',
  'expired',
  'error',
];

/** What the derivation reads off an account — its credential and its figures. */
export interface StateInput {
  status: 'active' | 'expired' | 'error';
  usage: {
    windows: readonly UsageWindow[];
    /** The vendor's own "limit reached" signal, when it sends one. */
    limited?: boolean | null;
  } | null;
}

export interface DerivedState {
  state: AccountState;
  /**
   * The instant every spent window has rolled over, or null: not limited, or
   * limited with no reset time to give (a spent window the vendor stated no
   * rollover for, or only its own "limit reached" flag). Set only while
   * `state` is `limited`.
   */
  limitedUntil: string | null;
  /**
   * One flag per window, in the order of `usage.windows`: whether that window
   * is why the account is limited — spent, general rather than scoped, and
   * not yet rolled over. Every flag is false unless `state` is `limited`.
   */
  blocking: boolean[];
}

/** A window's rollover as an instant, or NaN when the vendor gave none. */
function rolloverMs(window: UsageWindow): number {
  return window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
}

/** Whether a window's stated rollover is behind `nowMs`. */
function hasPassed(window: UsageWindow, nowMs: number): boolean {
  const rollover = rolloverMs(window);
  return Number.isFinite(rollover) && rollover <= nowMs;
}

/**
 * Whether a window has rolled over since `sinceMs`. A rollover the reading
 * already knew about — it was taken after it — is the reading's own news, not
 * a reason to doubt it.
 */
export function rolledOverSince(
  window: UsageWindow,
  sinceMs: number,
  nowMs: number,
): boolean {
  const rollover = rolloverMs(window);
  return Number.isFinite(rollover) && rollover > sinceMs && rollover <= nowMs;
}

/**
 * Whether a window stands at its ceiling. Only the session and weekly windows
 * can stop an account: a scoped one caps one model, and every other still
 * answers.
 */
function isSpentGeneralWindow(window: UsageWindow): boolean {
  return (
    window.kind !== 'scoped' &&
    window.utilization !== null &&
    Number.isFinite(window.utilization) &&
    window.utilization >= 100
  );
}

export function deriveAccountState(
  input: StateInput,
  nowMs: number,
): DerivedState {
  const windows = input.usage?.windows ?? [];
  const none = windows.map(() => false);

  if (input.status !== 'active') {
    return { state: input.status, limitedUntil: null, blocking: none };
  }

  // A rollover behind `now` frees the window even before the next reading
  // says so; one with no stated time cannot be shown to have passed.
  const blocking = windows.map(
    (window) => isSpentGeneralWindow(window) && !hasPassed(window, nowMs),
  );

  if (blocking.some(Boolean)) {
    const resets = windows
      .filter((_, index) => blocking[index])
      .map(rolloverMs);
    return {
      state: 'limited',
      limitedUntil: resets.every(Number.isFinite)
        ? new Date(Math.max(...resets)).toISOString()
        : null,
      blocking,
    };
  }

  // The vendor's own flag is authoritative when no window of its own says
  // otherwise — but a window that was full and has rolled over since is the
  // one thing that answers it.
  if (input.usage?.limited === true && !windows.some(isSpentGeneralWindow)) {
    return { state: 'limited', limitedUntil: null, blocking: none };
  }

  return { state: 'available', limitedUntil: null, blocking: none };
}
