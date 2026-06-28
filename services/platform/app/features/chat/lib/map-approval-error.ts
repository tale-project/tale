import { convexErrorCode } from '@/lib/utils/convex-error';

/**
 * `approvalCommon` message keys for the structured codes the approval mutations
 * (`updateApprovalStatus`, `removeRecommendedProduct`) raise on expected
 * failures. Declared as a named `*_KEYS` record — rather than inline string
 * literals — so the i18n orphan-key usage check can attribute them to the
 * `approvalCommon` namespace even though this helper receives its translator as
 * a parameter and has no in-file `useT('approvalCommon')` binding.
 */
const APPROVAL_ERROR_KEYS = {
  UNAUTHENTICATED: 'errorNotAuthenticated',
  NOT_FOUND: 'errorNotFound',
  ALREADY_RESOLVED: 'errorAlreadyResolved',
} as const;

/**
 * Map a thrown approval mutation error to a localized message. The approval
 * mutations raise `ConvexError({ code })` for expected failures; a raw message
 * would be redacted to "Server Error" in prod, so we key off the structured
 * code and fall back to the caller's generic message for anything unrecognized.
 *
 * Shared by every approval card (integration, workflow run/update/creation,
 * document write, knowledge write) so a rejected approval surfaces an
 * actionable reason instead of an opaque server error.
 */
// Named `translate` rather than the conventional `tCommon`: the i18n usage
// scanner treats any `t<Capital>(` call as a namespace-bound translator alias
// and would mis-attribute these keys to a `common` namespace, hiding the real
// `approvalCommon` keys as orphans. A plain name keeps the keys resolvable via
// the `APPROVAL_ERROR_KEYS` record above.
export function mapApprovalError(
  err: unknown,
  translate: (key: string) => string,
  fallback: string,
): string {
  switch (convexErrorCode(err)) {
    case 'UNAUTHENTICATED':
      return translate(APPROVAL_ERROR_KEYS.UNAUTHENTICATED);
    case 'NOT_FOUND':
      return translate(APPROVAL_ERROR_KEYS.NOT_FOUND);
    case 'ALREADY_RESOLVED':
      return translate(APPROVAL_ERROR_KEYS.ALREADY_RESOLVED);
    default:
      return fallback;
  }
}
