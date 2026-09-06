import { Hono } from 'hono';
import type { Sql } from 'postgres';

import { DEFAULT_TRUSTED_PROXIES } from '../../../lib/shared/schemas/governance.ts';
import { getString, isRecord } from '../../../lib/utils/type-utils.ts';
import { resolveSlackSigningSecret } from '../../core/http_connectors/deployment_config.ts';
import {
  SLACK_MAX_BODY_BYTES,
  verifySlackSignature,
} from '../../core/http_connectors/slack_signature.ts';
import { getClientIp } from '../../core/lib/utils/client_ip.ts';
import { readGovernancePolicy } from '../../lib/org-config.ts';
import { rateLimitedPlainResponse } from '../../lib/rate-limit-response.ts';
import {
  checkIpRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import { resolveTeamRoute } from './oauth.ts';

/**
 * The Slack Events API endpoint on Postgres — one deployment-wide Request URL
 * for every connected workspace (the 0.4 `http_connectors/slack_events.ts`).
 *
 * The three constraints that shape it are unchanged, and in this order:
 *
 *  1. NOTHING is acted on before the signature is verified. The raw body is
 *     read as text and verified as bytes (the REUSED `slack_signature.ts`:
 *     raw-byte base string, constant-time compare, five-minute replay
 *     window); parsing happens afterwards.
 *  2. The tenant comes from `team_id` and nowhere else. An unmapped workspace
 *     is refused — never delivered to "the only organization".
 *  3. Slack disables an endpoint that misses its three-second
 *     acknowledgement, so the response goes out as soon as routing is decided.
 *
 * What happens after routing: nothing yet. No surface consumes inbound Slack
 * events in this version (the conversational lane that would answer them is
 * not wired), so a verified, routed delivery is logged and acknowledged —
 * never queued into a handler that would only log it again. When a consumer
 * lands it takes delivery HERE, after `resolveTeamRoute`.
 *
 * Unverified traffic is throttled by client IP, and tokens are consumed only
 * on FAILURE, so a forged flood is bounded while genuine signed deliveries
 * are never rate-limited into a non-2xx (which Slack counts toward disabling
 * the endpoint).
 */

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function trustedProxies(): Promise<string[]> {
  const policy = await readGovernancePolicy('default', 'login_policy');
  return policy && policy.trustedProxies.length > 0
    ? policy.trustedProxies
    : [...DEFAULT_TRUSTED_PROXIES];
}

/**
 * Refuse a delivery we could not authenticate, charging the failure to the
 * caller's IP. A fault in the limiter itself must not turn a 401 into a 500,
 * so it is logged and the refusal stands.
 */
async function throttleAndRefuse(sql: Sql, req: Request): Promise<Response> {
  try {
    const ip = getClientIp(req.headers, await trustedProxies());
    await checkIpRateLimit(sql, 'connector:slack-events', ip);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return rateLimitedPlainResponse(error);
    }
    console.error(
      '[connectors:slack] rate-limit check failed; refusing the request anyway',
      error instanceof Error ? error.message : String(error),
    );
  }
  return textResponse('Invalid signature', 401);
}

export function createSlackEventRoutes(deps: { sql: Sql }): Hono {
  const app = new Hono();

  app.post('/events', async (c) => {
    // The exact bytes Slack signed. Read before anything looks at content.
    const rawBody = await c.req.text();
    if (rawBody.length > SLACK_MAX_BODY_BYTES) {
      return throttleAndRefuse(deps.sql, c.req.raw);
    }

    const signingSecret = resolveSlackSigningSecret();
    if (!signingSecret) {
      // Without the secret every delivery is unverifiable, so the endpoint
      // stays shut rather than processing unauthenticated input.
      console.error(
        '[connectors:slack] CONNECTOR_SLACK_SIGNING_SECRET is unset — refusing inbound events',
      );
      return textResponse('Slack connector is not configured', 503);
    }

    const verification = await verifySlackSignature({
      signingSecret,
      signatureHeader: c.req.header('X-Slack-Signature') ?? null,
      timestampHeader: c.req.header('X-Slack-Request-Timestamp') ?? null,
      rawBody,
    });
    if (!verification.ok) {
      console.warn(
        `[connectors:slack] rejected a delivery: signature ${verification.reason}`,
      );
      return throttleAndRefuse(deps.sql, c.req.raw);
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
    if (!isRecord(payload)) return textResponse('Bad request', 400);

    // Registration handshake. Slack signs it like any other delivery, so it
    // has already passed verification; echoing the challenge is all it needs.
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
      // Every event delivery carries the workspace it came from. Without it
      // there is no tenant to route to, and guessing one is the failure this
      // endpoint exists to avoid.
      console.warn('[connectors:slack] discarding a delivery with no team_id');
      return textResponse('Unknown workspace', 404);
    }

    const route = await resolveTeamRoute(deps.sql, teamId);
    if (!route) {
      console.warn(
        `[connectors:slack] no organization is connected to workspace ${teamId}`,
      );
      return textResponse('Unknown workspace', 404);
    }

    const event = isRecord(payload.event) ? payload.event : undefined;
    if (event) {
      // Verified and routed — and acknowledged, because nothing consumes
      // inbound Slack events yet (see the module header). The log line is
      // the whole delivery until a consumer takes it.
      console.info('[connectors:slack] inbound event acknowledged', {
        organizationId: route.organizationId,
        credentialId: route.credentialId,
        teamId,
        eventId: getString(payload, 'event_id'),
        eventType: getString(event, 'type'),
      });
    }

    return new Response(null, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  });

  return app;
}
