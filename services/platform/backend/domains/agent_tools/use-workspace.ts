import {
  USE_WORKSPACE_BRIEF_MAX_CHARS,
  USE_WORKSPACE_REASON_MAX_CHARS,
} from '../../../lib/agent/work-tools.ts';
import { failure, isArgsRecord, type WorkToolScope } from './scope.ts';

/**
 * `use_workspace` — hand the task to the full workspace.
 *
 * The turn only asks: what a hand-over does, and whether it may happen now,
 * is the lane's (`scope.escalation`). A task's lane ends the native turn and
 * starts the agent's coding harness on the same run, with the reason and the
 * brief the model wrote for its successor. A refusal comes back as a result
 * the model reads, so it can carry on with its other tools instead.
 */
export async function runUseWorkspace(
  scope: WorkToolScope,
  input: unknown,
): Promise<unknown> {
  if (scope.escalation === undefined) {
    return failure(
      'unavailable',
      'There is no full workspace to hand this to. Do what you can with your other tools.',
    );
  }
  if (!isArgsRecord(input)) {
    return failure(
      'invalid_args',
      'use_workspace takes {"reason": "<why>", "brief": "<what the workspace needs to carry on>"}.',
    );
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  const brief = typeof input.brief === 'string' ? input.brief.trim() : '';
  if (reason === '' || brief === '') {
    return failure(
      'invalid_args',
      'Give both a "reason" and a "brief": the workspace carries on from them without seeing this conversation.',
    );
  }
  if (
    reason.length > USE_WORKSPACE_REASON_MAX_CHARS ||
    brief.length > USE_WORKSPACE_BRIEF_MAX_CHARS
  ) {
    return failure(
      'invalid_args',
      `Keep the reason under ${USE_WORKSPACE_REASON_MAX_CHARS} characters and the brief under ${USE_WORKSPACE_BRIEF_MAX_CHARS}.`,
    );
  }
  const answer = await scope.escalation.request({ reason, brief });
  if (!answer.accepted) return failure('unavailable', answer.message);
  return {
    status: 'ok',
    message:
      'The task is handed to the full workspace, which carries on from your brief. End your turn now with one short sentence; do not make anything else.',
  };
}
