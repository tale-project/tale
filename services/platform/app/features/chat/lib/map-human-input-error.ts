import { convexErrorCode, convexErrorMessage } from '@/lib/utils/convex-error';

/**
 * Message keys for the structured codes the human-input mutations
 * (`submitHumanInputResponse`, `editHumanInputResponse`) raise on expected
 * failures. Split across two namespaces: the auth/not-found codes resolve to
 * `approvalCommon`, the response-state codes to `humanInputRequest`. Declared
 * as named `*_KEYS` records — rather than inline string literals — so the i18n
 * orphan-key usage check can attribute them to their namespaces even though
 * this helper receives its translators as parameters and has no in-file
 * `useT(...)` binding.
 */
const HUMAN_INPUT_COMMON_ERROR_KEYS = {
  UNAUTHENTICATED: 'errorNotAuthenticated',
  NOT_FOUND: 'errorNotFound',
} as const;

const HUMAN_INPUT_REQUEST_ERROR_KEYS = {
  ALREADY_RESPONDED: 'errorAlreadyResponded',
  NOT_EDITABLE: 'errorNotEditable',
  WORKFLOW_NOT_EDITABLE: 'errorWorkflowNotEditable',
  GENERATION_IN_PROGRESS: 'errorGenerationInProgress',
} as const;

/**
 * Map a thrown human-input submit/edit error to a localized message. The
 * backend raises `ConvexError({ code })` for expected failures (a raw message
 * is redacted to "Server Error" in prod), so we key off the structured code.
 * `BUDGET_EXCEEDED` carries a server-computed `message` shown verbatim.
 *
 * Shared by the human-input request card and the workflow-run approval card
 * (the paused-workflow human-input Submit path) so a rejected response surfaces
 * an actionable reason instead of an opaque server error.
 */
// Named `translate`/`translateCommon` rather than the conventional `t`/
// `tCommon`: the i18n usage scanner treats any `t<Capital>(` call as a
// namespace-bound translator alias and would mis-attribute these keys, hiding
// the real namespace keys as orphans. Plain names keep the keys resolvable via
// the `*_KEYS` records above.
export function mapHumanInputError(
  err: unknown,
  translate: (key: string) => string,
  translateCommon: (key: string) => string,
  fallback: string,
): string {
  switch (convexErrorCode(err)) {
    case 'UNAUTHENTICATED':
      return translateCommon(HUMAN_INPUT_COMMON_ERROR_KEYS.UNAUTHENTICATED);
    case 'NOT_FOUND':
      return translateCommon(HUMAN_INPUT_COMMON_ERROR_KEYS.NOT_FOUND);
    case 'ALREADY_RESPONDED':
      return translate(HUMAN_INPUT_REQUEST_ERROR_KEYS.ALREADY_RESPONDED);
    case 'NOT_EDITABLE':
      return translate(HUMAN_INPUT_REQUEST_ERROR_KEYS.NOT_EDITABLE);
    case 'WORKFLOW_NOT_EDITABLE':
      return translate(HUMAN_INPUT_REQUEST_ERROR_KEYS.WORKFLOW_NOT_EDITABLE);
    case 'GENERATION_IN_PROGRESS':
      return translate(HUMAN_INPUT_REQUEST_ERROR_KEYS.GENERATION_IN_PROGRESS);
    case 'BUDGET_EXCEEDED':
      return convexErrorMessage(err, fallback);
    default:
      return fallback;
  }
}
