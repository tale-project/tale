import { isRecord, getString } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import { httpAction } from '../../_generated/server';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../../lib/rate_limiter/helpers';
import { extractClientIp } from '../../workflows/triggers/helpers/validate';
import { verifySlackSignature } from './verify_signature';

function emptyAck(): Response {
  // Slack only needs a 2xx within 3s. Empty body is fine for event_callback.
  return new Response(null, { status: 200 });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  });
}

type ParsedEvent = {
  eventType: 'app_mention' | 'message_im';
  channel: string;
  messageTs: string;
  threadTs?: string;
  text: string;
  slackUserId: string;
};

/**
 * Decide whether an inbound `event_callback` is one we answer, and extract the
 * fields the processor needs. Returns null for events to ignore (the handler
 * still ACKs 200). We answer:
 *   - `app_mention` (bot @-mentioned in a channel)
 *   - `message` with `channel_type === 'im'` (a DM)
 * and drop anything with `bot_id`/`subtype` (the bot's own posts, edits,
 * joins, …) or a missing author.
 */
function parseEvent(event: Record<string, unknown>): ParsedEvent | null {
  if (event.bot_id !== undefined || event.subtype !== undefined) return null;

  const type = getString(event, 'type');
  const user = getString(event, 'user');
  const channel = getString(event, 'channel');
  const ts = getString(event, 'ts');
  if (!user || !channel || !ts) return null;

  const isMention = type === 'app_mention';
  const isDm = type === 'message' && event.channel_type === 'im';
  if (!isMention && !isDm) return null;

  return {
    eventType: isMention ? 'app_mention' : 'message_im',
    channel,
    messageTs: ts,
    threadTs: getString(event, 'thread_ts') || undefined,
    text: getString(event, 'text') ?? '',
    slackUserId: user,
  };
}

/**
 * Single Slack Events API Request URL for the shared Slack App. Verifies the
 * request signature, answers the URL-verification challenge, and hands valid
 * message events to an async processor (ACKing Slack within 3s). Always returns
 * 200 for authenticated requests — Slack disables endpoints that 5xx/time out.
 */
export const slackEventsHandler = httpAction(async (ctx, req) => {
  const ip = extractClientIp(req.headers);
  try {
    await checkIpRateLimit(ctx, 'integration:slack-events', ip);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return textResponse('Rate limit exceeded', 429);
    }
    throw error;
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error(
      '[slack:events] SLACK_SIGNING_SECRET is not configured; rejecting request',
    );
    return textResponse('Slack is not configured', 500);
  }

  // Read the raw body BEFORE parsing — the HMAC is over the exact bytes.
  const rawBody = await req.text();
  const verification = await verifySlackSignature({
    signingSecret,
    signatureHeader: req.headers.get('X-Slack-Signature'),
    timestampHeader: req.headers.get('X-Slack-Request-Timestamp'),
    rawBody,
  });
  if (!verification.ok) {
    return textResponse('Invalid signature', 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return textResponse('Invalid JSON body', 400);
  }
  if (!isRecord(body)) {
    return textResponse('Invalid body', 400);
  }

  // URL verification handshake (also signed).
  if (body.type === 'url_verification') {
    const challenge = getString(body, 'challenge') ?? '';
    return new Response(JSON.stringify({ challenge }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (body.type !== 'event_callback') {
    return emptyAck();
  }

  const event = isRecord(body.event) ? body.event : undefined;
  const eventId = getString(body, 'event_id');
  const teamId = getString(body, 'team_id');
  if (!event || !eventId || !teamId) {
    return emptyAck();
  }

  const parsed = parseEvent(event);
  if (!parsed) {
    return emptyAck();
  }

  const retryNumHeader = req.headers.get('X-Slack-Retry-Num');
  const retryNum = retryNumHeader
    ? Number.parseInt(retryNumHeader, 10)
    : undefined;

  await ctx.scheduler.runAfter(
    0,
    internal.integrations.slack.internal_actions.processSlackEvent,
    {
      eventId,
      teamId,
      channel: parsed.channel,
      threadTs: parsed.threadTs,
      messageTs: parsed.messageTs,
      text: parsed.text,
      slackUserId: parsed.slackUserId,
      eventType: parsed.eventType,
      retryNum: Number.isFinite(retryNum) ? retryNum : undefined,
    },
  );

  return emptyAck();
});

// Exported for unit tests.
export const __test = { parseEvent };
