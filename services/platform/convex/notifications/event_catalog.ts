/**
 * Notification event catalog — the single source of truth for which system
 * events can be pushed to external channels (Slack today), how each renders,
 * and whether it's on by default.
 *
 * Adding a new event type is a ONE-PLACE change: add an entry here, then emit
 * it from its source via `ctx.scheduler.runAfter(0, dispatchNotificationAction,
 * { organizationId, eventType, params })`. The dispatcher, the Slack sink, the
 * per-org toggle config, and the settings UI all derive from this map — none of
 * them need editing.
 *
 * `buildMessage` reads params defensively (this path must never throw and block
 * the workflow/approval that triggered it). Hook authors can type the object
 * they pass with `NotificationEventParams[...]` for autocompletion.
 */

import { getString } from '../../lib/utils/type-guards';

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
  'security.alert': { title: string; body?: string };
}

export type NotificationEventType = keyof NotificationEventParams;

interface NotificationEventDef {
  defaultEnabled: boolean;
  severity: NotificationSeverity;
  /** i18n key for the settings toggle label. */
  titleKey: string;
  buildMessage: (params: Record<string, unknown>) => NotificationMessage;
}

export const NOTIFICATION_EVENTS: Record<
  NotificationEventType,
  NotificationEventDef
> = {
  'workflow.failed': {
    defaultEnabled: true,
    severity: 'error',
    titleKey: 'integrations.slackNotify.events.workflowFailed',
    buildMessage: (p) => {
      const slug = getString(p, 'workflowSlug') ?? 'workflow';
      const error = getString(p, 'error');
      return {
        text: `:x: Workflow *${slug}* failed${error ? `: ${error}` : ''}`,
      };
    },
  },
  'workflow.completed': {
    defaultEnabled: false,
    severity: 'info',
    titleKey: 'integrations.slackNotify.events.workflowCompleted',
    buildMessage: (p) => {
      const slug = getString(p, 'workflowSlug') ?? 'workflow';
      return { text: `:white_check_mark: Workflow *${slug}* completed` };
    },
  },
  'security.alert': {
    defaultEnabled: true,
    severity: 'warning',
    titleKey: 'integrations.slackNotify.events.securityAlert',
    buildMessage: (p) => {
      const title = getString(p, 'title') ?? 'Security alert';
      const body = getString(p, 'body');
      return { text: `:warning: *${title}*${body ? `\n${body}` : ''}` };
    },
  },
};

export function isKnownNotificationEventType(
  value: string,
): value is NotificationEventType {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_EVENTS, value);
}

export function listNotificationEventTypes(): NotificationEventType[] {
  // filter with the type guard narrows to NotificationEventType[] without a cast
  return Object.keys(NOTIFICATION_EVENTS).filter(isKnownNotificationEventType);
}
