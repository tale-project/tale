import type { TaskReviewerState } from '@/app/lib/backend/contract/tasks';
import { backendErrorCode } from '@/lib/utils/backend-error';

/** One server-derived diagnosis serves people and native task_get clients. */
export function reviewerBlockedMessage(
  reason: NonNullable<
    TaskReviewerState['pendingReview']
  >['agentReviewBlockedReason'],
  t: (key: string) => string,
): string | undefined {
  switch (reason) {
    case 'reviewer_unavailable':
      return t('reviewer.agentUnavailable');
    case 'permission_missing':
      return t('reviewer.agentPermissionRequired');
    case 'source_required':
      return t('reviewer.sourceRequired');
    case 'source_changed':
      return t('reviewer.sourceChanged');
    case 'self_review':
      return t('reviewer.notIndependent');
    case 'human_policy':
      return t('reviewer.humanPolicy');
    case 'policy_unavailable':
      return t('reviewer.policyUnavailable');
    default:
      return undefined;
  }
}

/** Explain typed reviewer routing refusals at the edit surface. */
export function reviewerRefusalMessage(
  error: unknown,
  t: (key: string) => string,
): string | undefined {
  switch (backendErrorCode(error)) {
    case 'TASK_REVIEWER_STALE':
      return t('reviewer.stale');
    case 'TASK_REVIEWER_HANDOFF_REQUIRED':
      return t('reviewer.handoffRequired');
    case 'TASK_REVIEWER_BUSY':
      return t('reviewer.busy');
    case 'TASK_REVIEW_SOURCE_REQUIRED':
      return t('reviewer.sourceRequired');
    case 'TASK_REVIEW_SOURCE_CHANGED':
      return t('reviewer.sourceChanged');
    case 'TASK_REVIEWER_HUMAN_REQUIRED':
      return t('reviewer.humanPolicy');
    case 'GOVERNANCE_POLICY_UNAVAILABLE':
    case 'GOVERNANCE_POLICY_INVALID':
      return t('reviewer.policyUnavailable');
    case 'TASK_REVIEWER_NOT_INDEPENDENT':
      return t('reviewer.notIndependent');
    case 'TASK_AGENT_REVIEW_REQUIRED':
      return t('reviewer.agentRequired');
    case 'TASK_REVIEWER_PERMISSION_MISSING':
      return t('reviewer.agentPermissionRequired');
    case 'TASK_REVIEWER_INVALID':
      return t('reviewer.invalid');
    case 'TASK_REVIEWER_NO_EDIT_ACCESS':
      return t('reviewer.editorsOnly');
    default:
      return undefined;
  }
}
