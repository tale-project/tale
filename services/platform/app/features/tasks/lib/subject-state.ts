import { evaluateWhen } from '@/lib/shared/platform/when_predicate';
import type { TaskSubjectContract } from '@/lib/shared/schemas/task_contract';

/**
 * The OPERATIONAL state of an automation-owned task, derived purely from the
 * owning contract plus the live facts — the one classification the task
 * modal's subject panel, the board card's state chip and the create-flow
 * guidance all render from, so every surface tells the same story the status
 * choreography enacts (`decideTaskStatusTransition` is the verb-side twin of
 * this read-side classification).
 *
 * - `running`       — a subject-linked run is in flight (cancel is the verb).
 * - `review`        — the task sits in In review; `requestChanges` says
 *                     whether the contract maps "send it back" onto a rerun.
 * - `ready`         — the contract's `start.when` holds right now: an
 *                     explicit Start runs the workflow.
 * - `waiting_input` — `start.when` fails ONLY for missing input files: the
 *                     next step is uploading, not starting.
 * - `stalled`       — In progress with no live run on a startable contract:
 *                     the run died without parking the task; Start re-triggers
 *                     (the documented recovery path of `startTaskWorkflow`).
 * - `idle`          — nothing to offer beyond plain board moves.
 */
export type SubjectStateKind =
  | 'running'
  | 'review'
  | 'ready'
  | 'waiting_input'
  | 'stalled'
  | 'idle';

export interface SubjectState {
  kind: SubjectStateKind;
  /** For `review`: whether In review → In progress maps onto a rerun. */
  requestChanges: boolean;
}

/** The live facts the classification reads — computed by the caller exactly
 * the way the choreography executor computes them (`hasFiles` is only ever
 * true for `input.kind === 'folder'` contracts with a bound folder). */
export interface SubjectFacts {
  status: string;
  runActive: boolean;
  hasFiles: boolean;
}

export function deriveSubjectState(
  contract: TaskSubjectContract,
  facts: SubjectFacts,
): SubjectState {
  const requestChanges = contract.review?.requestChanges === true;
  if (facts.runActive) return { kind: 'running', requestChanges };
  if (facts.status === 'in_review') return { kind: 'review', requestChanges };

  const when = contract.start?.when;
  if (when === undefined) return { kind: 'idle', requestChanges };
  if (evaluateWhen(when, { status: facts.status, hasFiles: facts.hasFiles })) {
    return { kind: 'ready', requestChanges };
  }
  // Mirrors the choreography's missing-input diagnosis: would the gate pass
  // with input present? Then input is the ONLY blocker.
  if (
    !facts.hasFiles &&
    evaluateWhen(when, { status: facts.status, hasFiles: true })
  ) {
    return { kind: 'waiting_input', requestChanges };
  }
  if (facts.status === 'in_progress') {
    return { kind: 'stalled', requestChanges };
  }
  return { kind: 'idle', requestChanges };
}
