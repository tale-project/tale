import { convexErrorCode } from '@/lib/utils/convex-error';

/**
 * Map a thrown approval mutation error to a localized message. The approval
 * mutations (`updateApprovalStatus`, `removeRecommendedProduct`) raise
 * `ConvexError({ code })` for expected failures; a raw message would be
 * redacted to "Server Error" in prod, so we key off the structured code and
 * fall back to the caller's generic message for anything unrecognized.
 *
 * Shared by every approval card (integration, workflow run/update/creation,
 * document write, knowledge write) so a rejected approval surfaces an
 * actionable reason instead of an opaque server error.
 */
export function mapApprovalError(
  err: unknown,
  tCommon: (key: string) => string,
  fallback: string,
): string {
  switch (convexErrorCode(err)) {
    case 'UNAUTHENTICATED':
      return tCommon('errorNotAuthenticated');
    case 'NOT_FOUND':
      return tCommon('errorNotFound');
    case 'ALREADY_RESOLVED':
      return tCommon('errorAlreadyResolved');
    default:
      return fallback;
  }
}
