/**
 * Notification event catalog — metadata (client-safe).
 *
 * The single source of truth for which system events can be pushed to external
 * channels (Slack today), the per-event default-on state, severity, and the
 * i18n key for the settings toggle label. This module is import-safe for the
 * client bundle: it carries NO message-rendering code (which pulls the
 * server-only i18n tables). Message rendering lives in `event_catalog.ts`.
 *
 * Adding a new event type is a one-place change: add an entry here plus a
 * `buildMessage` case in `event_catalog.ts`, then emit it from its source via
 * `dispatchNotificationAction({ organizationId, eventType, params })`.
 */

export type NotificationSeverity = 'info' | 'warning' | 'error';

export interface NotificationMessage {
  /** Plain-text fallback (required by Slack). */
  text: string;
  /** Optional JSON string of Block Kit blocks (the connector expects a string). */
  blocks?: string;
}

/** Param shapes per event type — for hook-author autocompletion. */
export interface NotificationEventParams {
  'workflow.failed': { workflowSlug: string; error?: string };
  'workflow.completed': { workflowSlug: string };
  // Security alerts carry i18n KEYS (resolved server-side for Slack, client-side
  // for the in-app bell) plus the interpolation params those keys reference.
  'security.alert': {
    titleKey: string;
    bodyKey?: string;
    params?: Record<string, unknown>;
  };
}

export type NotificationEventType = keyof NotificationEventParams;

export interface NotificationEventMeta {
  defaultEnabled: boolean;
  severity: NotificationSeverity;
  /** i18n key for the settings toggle label. */
  titleKey: string;
}

export const NOTIFICATION_EVENT_META: Record<
  NotificationEventType,
  NotificationEventMeta
> = {
  'workflow.failed': {
    defaultEnabled: true,
    severity: 'error',
    titleKey: 'connectors.slackNotify.events.workflowFailed',
  },
  'workflow.completed': {
    defaultEnabled: false,
    severity: 'info',
    titleKey: 'connectors.slackNotify.events.workflowCompleted',
  },
  'security.alert': {
    defaultEnabled: true,
    severity: 'warning',
    titleKey: 'connectors.slackNotify.events.securityAlert',
  },
};

export function isKnownNotificationEventType(
  value: string,
): value is NotificationEventType {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_EVENT_META, value);
}

export function listNotificationEventTypes(): NotificationEventType[] {
  // filter with the type guard narrows to NotificationEventType[] without a cast
  return Object.keys(NOTIFICATION_EVENT_META).filter(
    isKnownNotificationEventType,
  );
}
