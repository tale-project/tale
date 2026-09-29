import { isTurnBudgetExceededError } from '../node_only/sandbox/turn_budget';
import {
  credentialRefusalMessage,
  credentialRetryAtMs,
} from '../provider_credentials/resolve_credential';
import { isSkillUnavailableError } from '../skills/skill_unavailable_error';
import type { TaskRunFailureCode } from './task_auto_retry';

/**
 * How a run that could not START settles: the reason the run row shows and
 * the failure code the auto-retry reads. Two start failures are decisions,
 * not faults, and never retried — the organization's spend cap, and a skill
 * the run cannot reach (the agent's configuration; three retries used to
 * burn on it before the author could act). Everything else is
 * `start_failed`, retried by default.
 *
 * A subscription broker whose every account is cooling down after a rate
 * limit also says when the first one is back (`retryAtMs`): the retry's
 * start waits for it instead of meeting the same refusal at once, which
 * used to spend the whole budget in seconds. The refused start still
 * counts as an attempt — a pool that other work keeps cooling would
 * otherwise hold the task in a wait loop with no end — but the attempt
 * after it starts once an account can serve.
 */
export function classifyStartFailure(err: unknown): {
  reason: string;
  failureCode: TaskRunFailureCode;
  retryAtMs?: number;
} {
  if (isTurnBudgetExceededError(err)) {
    return {
      reason: `the agent run was refused by the organization's spend cap: ${err.reason}`,
      failureCode: 'budget_exceeded',
    };
  }
  // A credential refusal carries its own sentence; its serialized payload
  // is for logs, not for the run card.
  const message =
    credentialRefusalMessage(err) ??
    (err instanceof Error ? err.message : String(err));
  const retryAtMs = credentialRetryAtMs(err);
  return {
    reason: `the agent run could not start: ${message}`,
    failureCode: isSkillUnavailableError(err)
      ? 'equipment_missing'
      : 'start_failed',
    ...(retryAtMs !== undefined && { retryAtMs }),
  };
}
