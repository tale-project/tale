/**
 * Slack delivery sink for system notifications.
 *
 * A thin sink (not the email-shaped `conversations` path): resolve the org's
 * configured notify channels and post via the already-built Slack `send_message`
 * integration operation, bypassing the human-approval gate (autonomous system
 * notification). Event-type semantics live in the catalog; this file only knows
 * "deliver this rendered message to Slack".
 */

import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { createDebugLog } from '../lib/debug_log';
import type { NotificationMessage } from './event_catalog_meta';

const debugLog = createDebugLog('DEBUG_SLACK_NOTIFY', '[SlackNotify]');

/**
 * Per-event opt-in resolution: an explicit org override (a boolean in
 * `connectionConfig.notifyEvents[eventType]`) wins; otherwise the catalog
 * default applies. Pure — unit-tested directly.
 */
export function resolveNotifyEnabled(
  connectionConfig: unknown,
  eventType: string,
  defaultEnabled: boolean,
): boolean {
  const cfg = isRecord(connectionConfig) ? connectionConfig : {};
  const notifyEvents = isRecord(cfg.notifyEvents) ? cfg.notifyEvents : {};
  const override = notifyEvents[eventType];
  return typeof override === 'boolean' ? override : defaultEnabled;
}

/**
 * Parse + dedupe the configured notify channel ids. Pure — unit-tested
 * directly. Dedupe prevents a channel listed twice from getting the message
 * twice.
 */
export function parseNotifyChannels(connectionConfig: unknown): string[] {
  const cfg = isRecord(connectionConfig) ? connectionConfig : {};
  if (!Array.isArray(cfg.notifyChannels)) return [];
  return [
    ...new Set(
      cfg.notifyChannels.filter((c): c is string => typeof c === 'string'),
    ),
  ];
}

export async function notifySlack(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    eventType: string;
    defaultEnabled: boolean;
    message: NotificationMessage;
  },
): Promise<void> {
  let cred;
  try {
    cred = await ctx.runQuery(
      internal.integrations.credential_queries.getBySlugInternal,
      { organizationId: args.organizationId, slug: 'slack' },
    );
  } catch (err) {
    // Never let a config lookup failure surface as a notification-path throw.
    console.error('[SlackNotify] credential lookup failed', {
      organizationId: args.organizationId,
      error: err instanceof Error ? err.message : err,
    });
    return;
  }
  if (!cred || !cred.isActive) {
    debugLog('slack not connected for org', args.organizationId, '— skipping');
    return;
  }

  const enabled = resolveNotifyEnabled(
    cred.connectionConfig,
    args.eventType,
    args.defaultEnabled,
  );
  if (!enabled) return;

  const channels = parseNotifyChannels(cred.connectionConfig);
  if (channels.length === 0) {
    debugLog('no notifyChannels configured for org', args.organizationId);
    return;
  }

  for (const channel of channels) {
    try {
      await ctx.runAction(
        internal.agent_tools.integrations.internal_actions.executeIntegration,
        {
          organizationId: args.organizationId,
          integrationName: 'slack',
          operation: 'send_message',
          params: {
            channel,
            text: args.message.text,
            ...(args.message.blocks ? { blocks: args.message.blocks } : {}),
          },
          skipApprovalCheck: true,
        },
      );
    } catch (err) {
      // Log, never swallow, never re-throw — a Slack delivery failure must not
      // fail the workflow/approval that triggered the notification.
      console.error('[SlackNotify] send failed', {
        organizationId: args.organizationId,
        channel,
        error: err instanceof Error ? err.message : err,
      });
    }
  }
}
