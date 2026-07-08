/**
 * Integration-dispatch HTTP surface — the endpoints the in-container MCP bridge
 * calls so the sandbox agent can use the org's connected integrations WITHOUT
 * the third-party credential ever entering the container.
 *
 *   POST /api/integrations/execute  body {slug, operation, args}
 *   POST /api/integrations/status   (no body)
 *
 * Auth: the bridge presents the per-session gateway virtual key (already in the
 * container env) as `Authorization: Bearer <vk>`. We hash it (sha256, matching
 * `hashVirtualKey`) and look it up in sandboxSessionTokens; organizationId and
 * the dispatch grant set (scope.integrationGrants = the agent's
 * integrationBindings) come FROM THAT ROW, never from the request body — a
 * container cannot spoof another org or widen its own grants (red-team M1).
 *
 * Every non-`ok` result is HTTP 200 with a structured body (never an isError
 * the model retry-loops on), so the agent relays the guidance instead.
 */

import { getString, isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import { httpAction } from '../_generated/server';
import { rateLimiter } from '../lib/rate_limiter';
import { wrapUntrusted } from '../lib/untrusted_content';
import { authSessionToken } from '../sandbox/dispatch_auth';
import { isUsable, type IntegrationAvailability } from './availability';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const executeIntegrationHandler = httpAction(async (ctx, req) => {
  const auth = await authSessionToken(ctx, req);
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

  // The forensic audit write is best-effort: a transient mutation failure must
  // never turn an already-executed integration call into an error response.
  const audit = async (outcome: string, operationType?: string) => {
    try {
      await ctx.runMutation(
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
    } catch (err) {
      console.warn(
        `[integrations/dispatch] audit write failed for ${slug}.${operation} (${outcome}):`,
        err,
      );
    }
  };

  // Availability: bound (from the token's grants) AND credential, reporting
  // ALL blockers (never short-circuited) so the agent can relay every fix.
  // Kept inside its own try/catch so an infra failure here (e.g. an
  // unresolvable org slug) returns the structured 200 the bridge expects
  // rather than an uncaught 500.
  let availability: IntegrationAvailability;
  try {
    availability = await ctx.runAction(
      internal.integrations.dispatch_internal.getIntegrationAvailability,
      {
        organizationId: auth.organizationId,
        slug,
        grantedSlugs: auth.integrationGrants,
      },
    );
  } catch (err) {
    console.error(
      `[integrations/dispatch] availability check failed for ${slug}.${operation}:`,
      err,
    );
    await audit('error');
    return json(200, {
      status: 'error',
      slug,
      operation,
      message: 'integration availability check failed; try again',
    });
  }
  if (!isUsable(availability)) {
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
  const auth = await authSessionToken(ctx, req);
  if (!auth) return json(401, { status: 'error', message: 'unauthorized' });
  let integrations: IntegrationAvailability[];
  try {
    integrations = await ctx.runAction(
      internal.integrations.dispatch_internal.getIntegrationStatuses,
      {
        organizationId: auth.organizationId,
        grantedSlugs: auth.integrationGrants,
      },
    );
  } catch (err) {
    console.error('[integrations/dispatch] status listing failed:', err);
    return json(200, {
      status: 'error',
      message: 'could not list integrations; try again',
      integrations: [],
    });
  }
  return json(200, { integrations });
});
