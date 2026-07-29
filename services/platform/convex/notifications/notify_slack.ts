/**
 * Slack delivery sink for system notifications.
 *
 * A thin sink (not the email-shaped `conversations` path): resolve the org's
 * configured notify channels and post via the already-built Slack `send_message`
 * connector operation, bypassing the human-approval gate (autonomous system
 * notification). Event-type semantics live in the catalog; this file only knows
 * "deliver this rendered message to Slack".
 */

import { isRecord } from '../../lib/utils/type-utils';
import type { ActionCtx } from '../_generated/server';
import { createDebugLog } from '../lib/debug_log';
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
  _ctx: ActionCtx,
  args: {
    organizationId: string;
    eventType: string;
    defaultEnabled: boolean;
    message: NotificationMessage;
  },
): Promise<void> {
  // Slack notification delivery rides the connectors backend, which is
  // offline while it is rebuilt. Notifications must never throw, so this
  // degrades to a logged skip — in-app notifications still deliver, and
  // Slack delivery resumes when the rebuilt connectors land.
  debugLog(
    'slack notify skipped',
    { organizationId: args.organizationId, eventType: args.eventType },
    '— connectors offline during the rebuild',
  );
}
