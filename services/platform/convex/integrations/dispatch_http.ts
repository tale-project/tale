/**
 * Integration-dispatch HTTP surface — the endpoints the in-container MCP bridge
 * calls so the sandbox agent can use the org's connected integrations WITHOUT
 * the third-party credential ever entering the container.
 *
 *   POST /api/integrations/execute  body {slug, operation, args}
 *   POST /api/integrations/status   (no body)
 *
 * Auth: the bridge presents the per-session Bifrost virtual key (already in the
 * container env) as `Authorization: Bearer <vk>`. We hash it (sha256, matching
 * `hashVirtualKey`) and look it up in sandboxSessionTokens; organizationId and
 * the dispatch grant set (scope.integrationGrants = the agent's
 * integrationBindings) come FROM THAT ROW, never from the request body — a
 * container cannot spoof another org or widen its own grants (red-team M1).
 *
 * Every non-`ok` result is HTTP 200 with a structured body (never an isError
 * the model retry-loops on), so the agent relays the guidance instead.
 */

import { getString, isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { httpAction } from '../_generated/server';
import { rateLimiter } from '../lib/rate_limiter';
import { wrapUntrusted } from '../lib/untrusted_content';
import type { IntegrationAvailability } from './availability';

const BEARER_PREFIX = 'Bearer ';

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface SessionAuth {
  organizationId: string;
  sessionId: string;
  grantedSlugs: string[];
}

/**
 * Resolve the session from the bearer token. Returns null on ANY auth failure
 * (missing/garbage header, unknown hash, revoked, expired) — callers map null
 * to 401. organizationId + grants are read from the token row, never the body.
 */
async function authSession(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  req: Request,
): Promise<SessionAuth | null> {
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await ctx.runQuery(
    internal.sandbox.session_queries.getSessionTokenByHash,
    { tokenHash },
  );
  if (!row) return null;
  if (row.revokedAt !== undefined) return null;
  if (row.expiresAt <= Date.now()) return null;
  return {
    organizationId: row.organizationId,
    sessionId: row.sessionId,
    grantedSlugs: row.scope.integrationGrants,
  };
}

export const executeIntegrationHandler = httpAction(async (ctx, req) => {
  const auth = await authSession(ctx, req);
  if (!auth) return json(401, { status: 'error', message: 'unauthorized' });

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return json(400, { status: 'error', message: 'invalid JSON body' });
  }
  const body: Record<string, unknown> = isRecord(parsed) ? parsed : {};
  const slug = getString(body, 'slug') ?? '';
  const operation = getString(body, 'operation') ?? '';
  if (!slug || !operation) {
    return json(400, {
      status: 'error',
      message: 'both "slug" and "operation" are required',
    });
  }
  const params: Record<string, unknown> = isRecord(body.args) ? body.args : {};

  const audit = (outcome: string, operationType?: string) =>
    ctx.runMutation(
      internal.integrations.dispatch_internal.recordIntegrationCall,
      {
        organizationId: auth.organizationId,
        sessionId: auth.sessionId,
        slug,
        operation,
        outcome,
        paramsFingerprint: Object.keys(params).sort().join(','),
        ...(operationType ? { operationType } : {}),
      },
    );

  // Availability: bound (from the token's grants) AND credential, reporting
  // ALL blockers (never short-circuited) so the agent can relay every fix.
  const availability: IntegrationAvailability = await ctx.runAction(
    internal.integrations.dispatch_internal.getIntegrationAvailability,
    {
      organizationId: auth.organizationId,
      slug,
      grantedSlugs: auth.grantedSlugs,
    },
  );
  if (availability.blockers.length > 0) {
    await audit('unavailable');
    return json(200, {
      status: 'unavailable',
      slug: availability.slug,
      title: availability.title,
      blockers: availability.blockers,
    });
  }

  // Per-session throttle on the otherwise-unmetered dispatch surface.
  const rl = await rateLimiter.limit(ctx, 'integrations:dispatch', {
    key: auth.sessionId,
  });
  if (!rl.ok) {
    await audit('rate_limited');
    return json(429, {
      status: 'error',
      message: 'integration calls are rate limited; slow down and retry',
      retryAfterMs: rl.retryAfter,
    });
  }

  try {
    // skipApprovalCheck is hard-wired false — the server-side approval card is
    // the ONLY gate on writes (the container runs --permission-mode
    // bypassPermissions), and the container must never be able to skip it.
    const result = await ctx.runAction(
      internal.agent_tools.integrations.internal_actions.executeIntegration,
      {
        organizationId: auth.organizationId,
        integrationName: slug,
        operation,
        params,
        skipApprovalCheck: false,
      },
    );
    if (isRecord(result) && result.requiresApproval === true) {
      await audit('requires_approval', 'write');
      const approvalId =
        typeof result.approvalId === 'string' ? result.approvalId : undefined;
      return json(200, {
        status: 'requires_approval',
        slug,
        operation,
        ...(approvalId ? { approvalId } : {}),
        message:
          `"${slug}.${operation}" is a write operation and needs user approval. ` +
          'It has been surfaced as an approval card in the chat — tell the user ' +
          'to approve it there; it will run automatically once approved.',
      });
    }
    await audit('ok');
    // The result is untrusted third-party data now flowing into the container —
    // wrap it so the agent treats it as DATA, not instructions (the TRUST RULES
    // addendum on the sandbox system prompt makes this wrapping meaningful).
    return json(200, {
      status: 'ok',
      slug,
      operation,
      result: wrapUntrusted(
        typeof result === 'string' ? result : JSON.stringify(result),
        { tool: 'integration', integration: slug, operation },
      ),
    });
  } catch (err) {
    await audit('error');
    const message = err instanceof Error ? err.message : String(err);
    // Bound any echoed value until F's secret-redaction pass lands at the
    // VM-result re-entry boundary.
    return json(200, {
      status: 'error',
      slug,
      operation,
      message: message.slice(0, 500),
    });
  }
});

export const integrationStatusHandler = httpAction(async (ctx, req) => {
  const auth = await authSession(ctx, req);
  if (!auth) return json(401, { status: 'error', message: 'unauthorized' });
  const integrations = await ctx.runAction(
    internal.integrations.dispatch_internal.getIntegrationStatuses,
    { organizationId: auth.organizationId, grantedSlugs: auth.grantedSlugs },
  );
  return json(200, { integrations });
});
