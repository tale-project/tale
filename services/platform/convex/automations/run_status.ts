/**
 * Which run statuses mean "this record is finished and will not change again".
 *
 * The retention sweep and the erasure path both need this, and getting it wrong
 * is the single most dangerous mistake either could make: a `waiting` run is
 * parked on a human decision (an approval, a `repeatUntil` not yet satisfied)
 * and may legitimately sit for weeks, while a `running` one is mid-flight.
 * Deleting either destroys live work rather than an old record — so the
 * predicate lives here, once, instead of being restated at each call site.
 */

/** Run statuses that will never change again. */
export const TERMINAL_RUN_STATUSES = [
  'success',
  'failed',
  'cancelled',
] as const;

export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];

/** Whether a run has finished — the only runs retention may ever touch. */
export function isTerminalRunStatus(status: string): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}
