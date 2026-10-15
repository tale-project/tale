/**
 * What a failed `forEach` item does — the one policy both executors apply,
 * so a run reads the same however it was carried out.
 *
 * By default (`onItemError: fail`) one failed item fails the whole step, as
 * it always did. With `onItemError: continue` a failed item is recorded as
 * failed, its entry in the step's output is `null`, and the next item runs:
 * one broken pull request, one thread whose draft the model fumbled, never
 * takes the others with it. The step itself fails only when every item
 * failed — a credential that stopped working, a model that is gone — and its
 * `onError` then decides what that does, so a systematic failure still ends
 * the run (and counts toward a schedule's failure streak) unless the author
 * chose `onError: continue` as well.
 *
 * What stops a run is never an item's failure: a stop or a time limit, a
 * walker that lost its claim, a write that may already have happened, a
 * server shutting down — the stepper never hands those here — and the run's
 * execution limit, which guards the run as a whole.
 */

import { failureCauseOf } from '../record/failure';
import type { NodeDef } from '../types';

/** Whether a failed item of this step is isolated rather than failing it. */
export function isolatesItemFailures(
  node: Pick<NodeDef, 'forEach' | 'onItemError'>,
): boolean {
  return typeof node.forEach === 'string' && node.onItemError === 'continue';
}

/** Whether this failure belongs to the run rather than to the item it
 * surfaced in: the execution limit counts every item of every step. */
export function failsTheRun(error: unknown): boolean {
  return failureCauseOf(error)?.reason === 'EXECUTION_LIMIT';
}

/** How many failed items the trace note names before it says "…". */
const NOTE_ITEMS = 5;

/** The trace note of a step that went on past failed items. */
export function itemFailureNote(
  failed: readonly number[],
  total: number,
): string {
  const named = failed.slice(0, NOTE_ITEMS).join(', ');
  const more = failed.length > NOTE_ITEMS ? ', …' : '';
  const which = `item${failed.length === 1 ? '' : 's'} ${named}${more}`;
  return `onItemError: continue — ${failed.length} of ${total} items failed (${which})`;
}
