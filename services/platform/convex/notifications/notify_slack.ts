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
import type { NotificationMessage } from './event_catalog';

const debugLog = createDebugLog('DEBUG_SLACK_NOTIFY', '[SlackNotify]');

export async function notifySlack(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    eventType: string;
    defaultEnabled: boolean;
    message: NotificationMessage;
  },
): Promise<void> {
  const cred = await ctx.runQuery(
    internal.integrations.credential_queries.getBySlugInternal,
    { organizationId: args.organizationId, slug: 'slack' },
  );
  if (!cred || !cred.isActive) {
    debugLog('slack not connected for org', args.organizationId, '— skipping');
    return;
  }

  const cfg = isRecord(cred.connectionConfig) ? cred.connectionConfig : {};

  // Per-event opt-in: org override wins, else the catalog default.
  const notifyEvents = isRecord(cfg.notifyEvents) ? cfg.notifyEvents : {};
  const override = notifyEvents[args.eventType];
  const enabled =
    typeof override === 'boolean' ? override : args.defaultEnabled;
  if (!enabled) return;

  const channels = Array.isArray(cfg.notifyChannels)
    ? cfg.notifyChannels.filter((c): c is string => typeof c === 'string')
    : [];
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
