import { convexErrorCode } from '@/lib/utils/convex-error';

/**
 * Map an execution mutation/action `ConvexError({ code })` (#2013) to a
 * localized message under the `common` namespace (`executionErrors.*`).
 * `cancelExecution` and `rerunExecution` raise structured codes for expected
 * failures; a raw `Error` message is redacted to "Server Error" in prod (and an
 * object-payload `ConvexError` would otherwise surface its raw JSON blob), so
 * without this the run/debug toasts can only show a generic message.
 * Unrecognized errors fall back to the caller's generic message.
 *
 * `t` must be scoped to the `common` namespace (`useT('common')`).
 */
export function mapExecutionError(
  err: unknown,
  t: (key: string) => string,
  fallback: string,
): string {
  switch (convexErrorCode(err)) {
    case 'UNAUTHENTICATED':
      return t('executionErrors.unauthenticated');
    case 'EXECUTION_NOT_FOUND':
      return t('executionErrors.notFound');
    case 'EXECUTION_NOT_CANCELABLE':
      return t('executionErrors.notCancelable');
    case 'EXECUTION_MISSING_SLUG':
      return t('executionErrors.missingWorkflow');
    default:
      return fallback;
  }
}
