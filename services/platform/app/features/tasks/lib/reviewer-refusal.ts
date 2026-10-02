import { backendErrorCode } from '@/lib/utils/backend-error';

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
    case 'TASK_REVIEWER_NOT_INDEPENDENT':
      return t('reviewer.notIndependent');
    case 'TASK_AGENT_REVIEW_REQUIRED':
      return t('reviewer.agentRequired');
    case 'TASK_REVIEWER_INVALID':
      return t('reviewer.invalid');
    case 'TASK_REVIEWER_NO_EDIT_ACCESS':
      return t('reviewer.editorsOnly');
    default:
      return undefined;
  }
}
