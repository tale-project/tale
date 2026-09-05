import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';

import {
  API_KEY_RATE_LIMIT,
  loadTrustedProxies,
  type Auth,
} from '../auth/auth.ts';
import { findOrganizationMember } from '../auth/membership.ts';
import { getClientIp, nodePeerAddress } from '../core/lib/utils/client_ip.ts';
import { resolveUserOrganization } from '../domains/organizations/service.ts';
import { rateLimitedResponse } from '../lib/rate-limit-response.ts';
import {
  RateLimitExceededError,
  checkIpRateLimit,
  checkUserRateLimit,
} from '../lib/rate-limit.ts';
import { domainErrorResponse, type RestEnv } from './shared.ts';
import { createAutomationRestRoutes } from './v1-automations.ts';
import { createCoreRoutes } from './v1-core.ts';
import { createRestMcpRoutes } from './v1-mcp.ts';
import { createProjectRestRoutes } from './v1-projects.ts';
import { createTaskRestRoutes } from './v1-tasks.ts';
import { createThreadRestRoutes } from './v1-threads.ts';
import { createRestWebsiteRoutes } from './v1-websites.ts';

/**
 * /api/v1 — the REST machine door: Bearer API key (the Better Auth apiKey
 * plugin verifies it through the same session surface the dashboard uses),
 * org resolution honouring `X-Organization-Slug` (membership-checked; a
 * multi-org key without the header is refused on write-capable routes
 * rather than guessed from the dashboard's last-active pointer — and the
 * tasks/projects families re-run that strictness on their reads too),
 * attributable rate limiting, and coded JSON errors.
 *
 * Rate limiting is keyed on WHO is calling, never on a header the caller
 * writes: an authenticated request charges the key holder's `rest:api`
 * budget (`user:<id>` — the key acts as its user, and the lane top-ups in
 * shared.ts key the same way); a Bearer key that fails to authenticate
 * charges the pre-auth `rest:auth-fail-ip` lane on the client IP derived
 * through the deployment's trusted-proxy list (the same `getClientIp` walk
 * the login and Slack lanes use — right-to-left from the TCP peer, so the
 * spoofable leftmost `X-Forwarded-For` entry never keys anything). A
 * request without a Bearer header costs nothing and charges nothing, so a
 * stranger cannot drain any key holder's budget.
 *
 * The resource families are thin adapters over the SAME domain services
 * the app surface uses — the 0.4 REST handlers' parsing and response
 * shapes mirrored onto them (`public/openapi.json` is the parity oracle),
 * so a consumer written against 0.4 keeps working. Families live beside
 * this door: v1-core (contacts, products, documents, knowledge, agents,
 * skills), v1-automations (+ runs), v1-projects (folders, uploads, files),
 * v1-tasks (external-ref intake, comments, start), v1-threads (chat).
 * `/websites` rides the crawler family (v1-websites) and `/api/v1/mcp`
 * rides automations_builder (v1-mcp); the automation webhook trigger
 * lives at `/api/automations/webhook/:token` (app.ts).
 */

/** The 429 every lane answers: the flat envelope plus `Retry-After`. */
/** The plugin's own per-key window, answered in the one 429 shape every
 * door speaks — the window is a refusal the limiter never threw. */
function rateLimited(c: Context<RestEnv>, retryAfterMs: number): Response {
  return rateLimitedResponse(
    c,
    new RateLimitExceededError('API key rate limit exceeded', retryAfterMs),
  );
}

/**
 * Better Auth's apiKey plugin enforces its own per-key window
 * (`API_KEY_RATE_LIMIT`) inside `getSession` and reports it as a thrown
 * `TOO_MANY_REQUESTS` APIError — a throttled key is not an invalid one.
 */
function isKeyWindowExceeded(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  return (
    Reflect.get(error, 'statusCode') === 429 ||
    Reflect.get(error, 'status') === 'TOO_MANY_REQUESTS'
  );
}

export function createRestV1Routes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  // ---- the door: API key → key holder's budget → org resolution → role ---
  app.use(async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    if (!header.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }
    const apiKey = header.slice('Bearer '.length).trim();
    if (apiKey === '') {
      return c.json({ error: 'Empty API key' }, 401);
    }

    // The client IP the trusted-proxy walk vouches for — from the TCP peer
    // when the runtime exposes it, never the caller's leftmost XFF entry.
    const ip = getClientIp(c.req.raw.headers, await loadTrustedProxies(), {
      peer: nodePeerAddress(c.env),
    });

    const syntheticHeaders = new Headers();
    syntheticHeaders.set('x-api-key', apiKey);
    let session: Awaited<ReturnType<Auth['api']['getSession']>> = null;
    try {
      session = await deps.auth.api.getSession({ headers: syntheticHeaders });
    } catch (error) {
      if (isKeyWindowExceeded(error)) {
        // The plugin's window is fixed and resets `timeWindow` after the last
        // request — the honest upper bound on the wait.
        return rateLimited(c, API_KEY_RATE_LIMIT.timeWindow);
      }
      // Anything else that stops the key from verifying reads as invalid.
      session = null;
    }
    if (!session?.user) {
      // A key that failed to authenticate is charged to its source IP —
      // never to any key holder. Over the failure budget the door answers
      // 429 before 401, so an abusive source learns to back off.
      try {
        await checkIpRateLimit(deps.sql, 'rest:auth-fail-ip', ip);
      } catch (error) {
        if (error instanceof RateLimitExceededError) {
          return rateLimitedResponse(c, error);
        }
        throw error;
      }
      return c.json({ error: 'Invalid API key' }, 401);
    }

    // Authenticated: the shared `rest:api` budget belongs to the key holder,
    // charged before org resolution so a misdirected request still counts.
    try {
      await checkUserRateLimit(deps.sql, 'rest:api', session.user.id);
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        return rateLimitedResponse(c, error);
      }
      throw error;
    }

    const orgSlugHeader = c.req.header('x-organization-slug')?.trim();
    let resolved;
    try {
      resolved = await resolveUserOrganization(deps.sql, {
        userId: session.user.id,
        ...(orgSlugHeader ? { orgSlug: orgSlugHeader } : {}),
        // Machine writes must never follow the dashboard's last-active
        // pointer across tenants — multi-org keys say which org they mean.
        requireExplicitOrgSlug: c.req.method !== 'GET',
      });
    } catch (error) {
      // The domain's own status: 400 when a multi-org key named no org, 403
      // for a foreign slug, 404 for an unknown one. Anything else — a
      // driver failure — is an outage for the app-level handler to report,
      // never a 400 with the driver's text on the wire.
      return domainErrorResponse(c, error);
    }

    const member = await findOrganizationMember(
      deps.sql,
      resolved.organizationId,
      session.user.id,
    );
    if (member === null || member.role === 'disabled') {
      return c.json(
        { error: `Not a member of organization "${resolved.orgSlug}".` },
        403,
      );
    }

    c.set('userId', session.user.id);
    c.set('userEmail', session.user.email ?? '');
    c.set('organizationId', resolved.organizationId);
    c.set('orgSlug', resolved.orgSlug);
    c.set('role', member.role);
    c.set('orgExplicit', Boolean(orgSlugHeader));
    c.set('clientIp', ip);
    return next();
  });

  app.route('/', createCoreRoutes({ sql: deps.sql }));
  app.route('/', createProjectRestRoutes({ sql: deps.sql }));
  app.route('/', createTaskRestRoutes({ sql: deps.sql }));
  app.route('/', createThreadRestRoutes({ sql: deps.sql }));
  app.route('/', createAutomationRestRoutes({ sql: deps.sql }));
  app.route('/', createRestWebsiteRoutes({ sql: deps.sql }));
  app.route('/', createRestMcpRoutes({ sql: deps.sql }));

  return app;
}
