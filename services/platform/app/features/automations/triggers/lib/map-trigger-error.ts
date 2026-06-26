import { convexErrorCode } from '@/lib/utils/convex-error';

/**
 * Map a slug-mutation `ConvexError({ code })` to a localized message under the
 * `automations` namespace (`triggers.errors.*`). The trigger mutations raise
 * structured codes for expected failures; a raw `Error` message is redacted to
 * "Server Error" in prod, so without this the dialogs can only show a generic
 * toast. Unrecognized errors fall back to the caller's generic message.
 *
 * `t` must be scoped to the `automations` namespace (`useT('automations')`).
 */
export function mapTriggerError(
  err: unknown,
  t: (key: string) => string,
  fallback: string,
): string {
  switch (convexErrorCode(err)) {
    case 'UNAUTHENTICATED':
      return t('triggers.errors.unauthenticated');
    case 'INVALID_SLUG':
      return t('triggers.errors.invalidSlug');
    case 'NOT_INSTALLED':
      return t('triggers.errors.notInstalled');
    case 'NOT_FOUND':
      return t('triggers.errors.notFound');
    case 'APP_OWNED_WORKFLOW':
      return t('triggers.errors.appOwnedWorkflow');
    case 'INVALID_EVENT_TYPE':
      return t('triggers.errors.invalidEventType');
    case 'DUPLICATE_SUBSCRIPTION':
      return t('triggers.errors.duplicateSubscription');
    default:
      return fallback;
  }
}
