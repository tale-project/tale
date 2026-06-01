import { isRecord, getString } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { httpAction } from '../../_generated/server';
import { decryptString } from '../../lib/crypto/decrypt_string';
import {
  checkIpRateLimit,
  checkTeamRateLimit,
  RateLimitExceededError,
} from '../../lib/rate_limiter/helpers';
import { getClientIp, loadTrustedProxies } from '../../lib/utils/client_ip';
import { verifySlackSignature } from './verify_signature';

function emptyAck(): Response {
  // Slack only needs a 2xx within 3s. Empty body is fine for event_callback.
  return new Response(null, { status: 200 });
}

function textResponse(
  body: string,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain', ...headers },
  });
}

/**
 * Reject a request we could not verify as a signed Slack delivery. Throttles
 * forged/unsigned floods by (spoof-resistant) client IP — tokens are consumed
 * only here, on failure, so legitimate signed traffic never depletes the
 * bucket. Returns 429 under flood, otherwise 401.
 */
async function throttleAndReject(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  try {
    const trusted = await loadTrustedProxies(ctx);
    const ip = getClientIp(req.headers, trusted);
    await checkIpRateLimit(ctx, 'integration:slack-events', ip);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return textResponse('Rate limit exceeded', 429, {
        'Retry-After': String(Math.ceil(error.retryAfter / 1000)),
      });
    }
    throw error;
  }
  return textResponse('Invalid signature', 401);
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
 * Single Slack Events API Request URL for every org's Slack App. Each org
 * brings its own Slack app (client id/secret + signing secret are pasted in the
 * admin UI and stored encrypted on the per-org credential — there are no
 * deployment-wide SLACK_* env vars). The handler therefore resolves the signing
 * secret per request before verifying the HMAC:
 *   - `event_callback` carries a `team_id`, which routes to the installing org
 *     (slackInstallations) and its stored signing secret.
 *   - `url_verification` carries no team_id/api_app_id and fires during setup
 *     (before any OAuth install exists), so it is verified by trying every
 *     configured Slack signing secret and echoing the challenge on a match.
 *
 * The untrusted body is parsed first ONLY to extract that routing key; nothing
 * from it is acted on until verifySlackSignature (which also enforces the
 * timestamp/replay window) passes over the original raw bytes.
 *
 * Rate limiting: forged/unsigned requests are throttled by client IP (401, or
 * 429 under flood) — tokens consumed only on failure; verified signed traffic
 * has a per-workspace backstop that ACKs 200 and drops on overflow (Slack
 * counts a non-2xx toward disabling the endpoint).
 */
export const slackEventsHandler = httpAction(async (ctx, req) => {
  // Read the raw body BEFORE parsing — the HMAC is over the exact bytes.
  const rawBody = await req.text();

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    // A malformed body cannot be a signed Slack delivery — treat as forged.
    return throttleAndReject(ctx, req);
  }
  if (!isRecord(body)) {
    return throttleAndReject(ctx, req);
  }

  const signatureHeader = req.headers.get('X-Slack-Signature');
  const timestampHeader = req.headers.get('X-Slack-Request-Timestamp');

  // URL-verification handshake: no team_id to route by, so verify against every
  // configured Slack signing secret (read directly — no install row exists yet)
  // and echo the challenge on the first match.
  if (body.type === 'url_verification') {
    const encryptedSecrets = await ctx.runQuery(
      internal.integrations.credential_queries.listSlackSigningSecrets,
      {},
    );
    for (const enc of encryptedSecrets) {
      let signingSecret: string;
      try {
        signingSecret = await decryptString(enc);
      } catch (error) {
        console.error(
          '[slack:events] failed to decrypt a Slack signing secret',
          error,
        );
        continue;
      }
      const verification = await verifySlackSignature({
        signingSecret,
        signatureHeader,
        timestampHeader,
        rawBody,
      });
      if (verification.ok) {
        const challenge = getString(body, 'challenge') ?? '';
        return new Response(JSON.stringify({ challenge }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return throttleAndReject(ctx, req);
  }

  // Every other delivery (event_callback, app_rate_limited, …) carries a
  // team_id. Resolve the per-org signing secret and verify before trusting it.
  const teamId = getString(body, 'team_id');
  if (!teamId) {
    return throttleAndReject(ctx, req);
  }

  const encryptedSecret = await ctx.runQuery(
    internal.integrations.slack_installations.resolveSlackSigningSecretByTeamId,
    { teamId },
  );
  if (!encryptedSecret) {
    return throttleAndReject(ctx, req);
  }
  let signingSecret: string;
  try {
    signingSecret = await decryptString(encryptedSecret);
  } catch (error) {
    console.error(
      `[slack:events] failed to decrypt signing secret for team ${teamId}`,
      error,
    );
    return throttleAndReject(ctx, req);
  }
  const verification = await verifySlackSignature({
    signingSecret,
    signatureHeader,
    timestampHeader,
    rawBody,
  });
  if (!verification.ok) {
    return throttleAndReject(ctx, req);
  }

  // --- The request is now verified as a signed delivery from this workspace. ---

  if (body.type !== 'event_callback') {
    // e.g. app_rate_limited — signed, but nothing to process.
    return emptyAck();
  }

  const event = isRecord(body.event) ? body.event : undefined;
  const eventId = getString(body, 'event_id');
  if (!event || !eventId) {
    return emptyAck();
  }

  const parsed = parseEvent(event);
  if (!parsed) {
    return emptyAck();
  }

  // Per-workspace flood backstop for SIGNED traffic. On overflow, ACK 200 and
  // drop — never 429 — because Slack counts a non-2xx toward disabling the
  // endpoint. Keyed by team_id so one noisy workspace can't starve others.
  try {
    await checkTeamRateLimit(ctx, 'integration:slack-events', teamId);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      console.warn(
        `[slack:events] team ${teamId} over rate limit; dropping event ${eventId}`,
      );
      return emptyAck();
    }
    throw error;
  }

  // Slack re-delivers on a slow ACK; we ACK 200 below before any work, so a
  // retry header just signals a prior slow round-trip — log it, nothing more.
  if (req.headers.get('X-Slack-Retry-Num')) {
    console.warn(
      `[slack:events] Slack retried event ${eventId} (reason: ${
        req.headers.get('X-Slack-Retry-Reason') ?? 'unknown'
      })`,
    );
  }

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
    },
  );

  return emptyAck();
});

// Exported for unit tests.
export const __test = { parseEvent };
