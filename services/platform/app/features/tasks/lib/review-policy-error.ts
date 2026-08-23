import { convexErrorCode } from '@/lib/utils/convex-error';

/**
 * Localized copy for the org `review_policy` refusals a status change can now
 * raise (leaving In review for Done IS the review approve). Shared by every
 * surface that writes task status — the sheet's picker, the subject panel's
 * Approve, and the board drag — so a refusal explains itself instead of
 * falling through to the generic error toast.
 */
export function reviewPolicyErrorMessage(
  error: unknown,
  t: (key: string) => string,
): string | undefined {
  switch (convexErrorCode(error)) {
    case 'REVIEW_INDEPENDENT_REVIEWER_REQUIRED':
      return t('review.independentReviewerRequired');
    case 'REVIEW_COMPETENCE_REQUIRED':
      return t('review.competenceRequired');
    default:
      return undefined;
  }
}
