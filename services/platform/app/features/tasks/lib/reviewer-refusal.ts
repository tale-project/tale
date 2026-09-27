import { backendErrorCode } from '@/lib/utils/backend-error';

/**
 * Localized copy for a refused **Reviewer** designation: the server takes
 * only a live member who can edit the project — the rule the review gate
 * resolves by — and the picker offers only those, so a refusal means the
 * list went stale (someone lost access while it was open). Says what the
 * picker's own hint says instead of the generic error toast.
 */
export function reviewerRefusalMessage(
  error: unknown,
  t: (key: string) => string,
): string | undefined {
  switch (backendErrorCode(error)) {
    case 'TASK_REVIEWER_INVALID':
    case 'TASK_REVIEWER_NO_EDIT_ACCESS':
      return t('reviewer.editorsOnly');
    default:
      return undefined;
  }
}
