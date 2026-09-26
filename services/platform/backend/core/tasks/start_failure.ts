import { isTurnBudgetExceededError } from '../node_only/sandbox/turn_budget';
import { isSkillUnavailableError } from '../skills/skill_unavailable_error';
import type { TaskRunFailureCode } from './task_auto_retry';

/**
 * How a run that could not START settles: the reason the run row shows and
 * the failure code the auto-retry reads. Two start failures are decisions,
 * not faults, and never retried — the organization's spend cap, and a skill
 * the run cannot reach (the agent's configuration; three retries used to
 * burn on it before the author could act). Everything else is
 * `start_failed`, retried by default.
 */
export function classifyStartFailure(err: unknown): {
  reason: string;
  failureCode: TaskRunFailureCode;
} {
  if (isTurnBudgetExceededError(err)) {
    return {
      reason: `the agent run was refused by the organization's spend cap: ${err.reason}`,
      failureCode: 'budget_exceeded',
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    reason: `the agent run could not start: ${message}`,
    failureCode: isSkillUnavailableError(err)
      ? 'equipment_missing'
      : 'start_failed',
  };
}
