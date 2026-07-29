/**
 * The Slack Events API endpoint — one deployment-wide Request URL for every
 * connected workspace.
 *
 * The handler is written around three constraints, in this order:
 *
 *  1. NOTHING is acted on before the signature is verified. The raw body is
 *     read as text and verified as bytes; parsing happens afterwards, on a
 *     payload we have already proved came from Slack. (The URL-verification
 *     handshake is the one place the body's shape is inspected first, and even
 *     there the challenge is only echoed after verification passes.)
 *  2. The tenant comes from `team_id` and from nowhere else. An unmapped
 *     workspace is refused, never delivered to "the only organization" or fanned
 *     out; see `slack_routing.ts`.
 *  3. Slack disables an endpoint that misses its three-second acknowledgement,
 *     so the response is sent as soon as routing is decided and the actual work
 *     is scheduled.
 *
 * Unverified traffic is throttled by client IP: tokens are consumed only on
 * FAILURE, so a forged flood is bounded while genuine signed deliveries are
 * never rate-limited into a non-2xx (which Slack counts toward disabling the
 * endpoint).
 */

import { getString, isRecord } from '../../lib/utils/type-utils';
import type { ActionCtx } from '../_generated/server';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../lib/rate_limiter/helpers';
import { getClientIp, loadTrustedProxies } from '../lib/utils/client_ip';
import { resolveSlackSigningSecret } from './deployment_config';
import { deliverInboundEventRef, resolveTeamRouteRef } from './function_refs';
import { SLACK_MAX_BODY_BYTES, verifySlackSignature } from './slack_signature';

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Refuse a delivery we could not authenticate, charging the failure to the
 * caller's IP. A non-rate-limit fault in the limiter itself must not turn a 401
 * into a 500, so it is logged and the refusal stands.
 */
async function throttleAndRefuse(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  try {
    const trusted = await loadTrustedProxies(ctx);
    const ip = getClientIp(req.headers, trusted);
    await checkIpRateLimit(ctx, 'connector:slack-events', ip);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return new Response('Rate limit exceeded', {
        status: 429,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Retry-After': String(Math.ceil(error.retryAfter / 1000)),
        },
      });
    }
    console.error(
      '[connectors:slack] rate-limit check failed; refusing the request anyway',
      error instanceof Error ? error.message : String(error),
    );
  }
  return textResponse('Invalid signature', 401);
}

/** POST /api/connectors/slack/events */
export async function slackEventsHandler(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  // The exact bytes Slack signed. Read before anything looks at the content.
  const rawBody = await req.text();
  if (rawBody.length > SLACK_MAX_BODY_BYTES) {
    return throttleAndRefuse(ctx, req);
  }

  const signingSecret = resolveSlackSigningSecret();
  if (!signingSecret) {
    // Without the secret every delivery is unverifiable, so the endpoint stays
    // shut rather than processing unauthenticated input.
    console.error(
      '[connectors:slack] CONNECTOR_SLACK_SIGNING_SECRET is unset — refusing inbound events',
    );
    return textResponse('Slack connector is not configured', 503);
  }

  const verification = await verifySlackSignature({
    signingSecret,
    signatureHeader: req.headers.get('X-Slack-Signature'),
    timestampHeader: req.headers.get('X-Slack-Request-Timestamp'),
    rawBody,
  });
  if (!verification.ok) {
    console.warn(
      `[connectors:slack] rejected a delivery: signature ${verification.reason}`,
    );
    return throttleAndRefuse(ctx, req);
  }

  // Verified: only now is the body worth parsing.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Signed but not JSON — a genuinely broken sender, not an attacker.
    console.warn('[connectors:slack] discarding a signed non-JSON delivery');
    return textResponse('Bad request', 400);
  }
  if (!isRecord(payload)) {
    return textResponse('Bad request', 400);
  }

  // Registration handshake. Slack signs it like any other delivery, so it has
  // already passed verification above; echoing the challenge is all it needs.
  if (payload.type === 'url_verification') {
    const challenge = getString(payload, 'challenge');
    if (!challenge) return textResponse('Bad request', 400);
    return new Response(JSON.stringify({ challenge }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }

  const teamId = getString(payload, 'team_id');
  if (!teamId) {
    // Every event delivery carries the workspace it came from. Without it there
    // is no tenant to route to, and guessing one is the failure this endpoint
    // exists to avoid.
    console.warn('[connectors:slack] discarding a delivery with no team_id');
    return textResponse('Unknown workspace', 404);
  }

  const route = await ctx.runQuery(resolveTeamRouteRef, { teamId });
  if (!route) {
    console.warn(
      `[connectors:slack] no organization is connected to workspace ${teamId}`,
    );
    return textResponse('Unknown workspace', 404);
  }

  const event = isRecord(payload.event) ? payload.event : undefined;
  if (event) {
    // Scheduled, not awaited: acknowledging inside Slack's three-second budget
    // is what keeps the endpoint enabled.
    await ctx.scheduler.runAfter(0, deliverInboundEventRef, {
      organizationId: route.organizationId,
      credentialId: route.credentialId,
      teamId,
      eventId: getString(payload, 'event_id'),
      eventType: getString(event, 'type'),
      event,
    });
  }

  return new Response(null, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
