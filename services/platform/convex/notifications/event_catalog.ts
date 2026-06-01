/**
 * Notification event catalog — server-side message rendering.
 *
 * Re-exports the client-safe metadata (`event_catalog_meta`) and adds
 * `buildNotificationMessage`, which renders a delivery-ready, locale-aware
 * message for an event. It reads params defensively (this path must never throw
 * and block the workflow/approval that triggered it) and renders through the
 * server i18n tables, so the client bundle must import from
 * `event_catalog_meta` directly — not from here.
 */

import { getString, isRecord } from '../../lib/utils/type-guards';
import {
  escapeSlackText,
  renderNotificationMessage,
} from './notification_messages';

export * from './event_catalog_meta';

import type {
  NotificationEventType,
  NotificationMessage,
} from './event_catalog_meta';

/**
 * Render the outbound message for an event in the org's locale. `params` is the
 * untrusted payload supplied by the emitting hook; every read is defensive.
 */
export function buildNotificationMessage(
  eventType: NotificationEventType,
  params: Record<string, unknown>,
  locale: string,
): NotificationMessage {
  switch (eventType) {
    case 'workflow.failed': {
      const slug = getString(params, 'workflowSlug') ?? 'workflow';
      const error = getString(params, 'error');
      const headline = renderNotificationMessage(locale, 'workflowFailed', {
        slug,
      });
      // The error string is a runtime message, not a translatable phrase; append
      // it (escaped + truncated) after the localized headline.
      const suffix = error ? `: ${escapeSlackText(truncate(error))}` : '';
      return { text: `:x: ${headline}${suffix}` };
    }
    case 'workflow.completed': {
      const slug = getString(params, 'workflowSlug') ?? 'workflow';
      const headline = renderNotificationMessage(locale, 'workflowCompleted', {
        slug,
      });
      return { text: `:white_check_mark: ${headline}` };
    }
    case 'security.alert': {
      const titleKey = getString(params, 'titleKey');
      const bodyKey = getString(params, 'bodyKey');
      const interp = isRecord(params.params) ? params.params : undefined;
      const title = titleKey
        ? renderNotificationMessage(locale, titleKey, interp)
        : 'Security alert';
      const body = bodyKey
        ? renderNotificationMessage(locale, bodyKey, interp)
        : undefined;
      return { text: `:warning: *${title}*${body ? `\n${body}` : ''}` };
    }
    default: {
      // Exhaustiveness guard: a new event type must add a case above.
      const _exhaustive: never = eventType;
      return { text: String(_exhaustive) };
    }
  }
}

const MAX_ERROR_LEN = 500;

function truncate(value: string): string {
  return value.length > MAX_ERROR_LEN
    ? `${value.slice(0, MAX_ERROR_LEN)}…`
    : value;
}
