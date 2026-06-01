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
import {
  checkOrganizationRateLimit,
  RateLimitExceededError,
} from '../lib/rate_limiter/helpers';
import type { NotificationMessage } from './event_catalog_meta';

const debugLog = createDebugLog('DEBUG_SLACK_NOTIFY', '[SlackNotify]');

const SLACK_RATE_LIMIT_RETRY_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `send` once; on a Slack 429 ("rate limited" / 429) back off and retry
 * exactly once, mirroring the inbound `postSlackReply` discipline so the two
 * Slack write paths behave the same. Errors are logged and swallowed — a Slack
 * delivery failure must never fail the workflow/approval that triggered the
 * notification. `sleep` is injectable so the retry is unit-testable without a
 * real delay.
 */
export async function sendWithSlack429Retry(
  send: () => Promise<unknown>,
  meta: { organizationId: string; channel: string },
  deps: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const doSleep = deps.sleep ?? sleep;
  try {
    await send();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/rate.?limit|\b429\b/i.test(message)) {
      console.warn('[SlackNotify] send rate-limited; retrying once', meta);
      await doSleep(SLACK_RATE_LIMIT_RETRY_MS);
      try {
        await send();
        return;
      } catch (retryErr) {
        console.error('[SlackNotify] send failed after 429 retry', {
          ...meta,
          error: retryErr instanceof Error ? retryErr.message : retryErr,
        });
        return;
      }
    }
    console.error('[SlackNotify] send failed', { ...meta, error: message });
  }
}

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

  // Per-org backstop so a burst of notification events can't flood Slack. Best
  // effort: on overflow drop this delivery (log) rather than throwing into the
  // fire-and-forget dispatcher. The security fan-out already schedules one
  // dispatch per org, so each org is bounded independently.
  try {
    await checkOrganizationRateLimit(ctx, 'notify:slack', args.organizationId);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      console.warn(
        '[SlackNotify] org over notify rate limit; dropping',
        args.eventType,
        args.organizationId,
      );
      return;
    }
    throw err;
  }

  for (const channel of channels) {
    // Per-channel error isolation lives in sendWithSlack429Retry (log, never
    // rethrow), which also retries once on a Slack 429 — matching postSlackReply.
    await sendWithSlack429Retry(
      () =>
        ctx.runAction(
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
        ),
      { organizationId: args.organizationId, channel },
    );
  }
}
