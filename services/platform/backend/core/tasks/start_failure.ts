import { isTurnBudgetExceededError } from '../node_only/sandbox/turn_budget';
import {
  credentialRetryAtMs,
  runFailureMessage,
} from '../provider_credentials/resolve_credential';
import { isSkillUnavailableError } from '../skills/skill_unavailable_error';
import type { TaskRunFailureCode } from './task_auto_retry';
import { isTaskInputMissingError } from './task_input_missing_error';

/**
 * How a run that could not START settles: the reason the run row shows and
 * the failure code the auto-retry reads. Three start failures are decisions
 * or facts a retry cannot change, and never retried — the organization's
 * spend cap, a skill the run cannot reach (the agent's configuration; three
 * retries used to burn on it before the author could act), and an attachment
 * whose bytes left the object store (named in the reason; whoever can change
 * the task removes it or uploads it again). Everything else is
 * `start_failed`, retried by default.
 *
 * A subscription broker whose every account is cooling down after a rate
 * limit refuses with `credential_cooldown` and says when the first account
 * is back (`retryAtMs`): the retry's start waits for it instead of meeting
 * the same refusal at once, which used to spend the whole budget in
 * seconds. The wait is free only right after the run's own 429
 * (`freeCooldownWaits`); any other refused start counts, so a pool that
 * other work keeps cooling cannot hold the task in an endless wait.
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
  const retryAtMs = credentialRetryAtMs(err);
  return {
    reason: `the agent run could not start: ${runFailureMessage(err)}`,
    failureCode:
      retryAtMs !== undefined
        ? 'credential_cooldown'
        : isSkillUnavailableError(err)
          ? 'equipment_missing'
          : isTaskInputMissingError(err)
            ? 'input_missing'
            : 'start_failed',
    ...(retryAtMs !== undefined && { retryAtMs }),
  };
}
