import { Hono } from 'hono';
import type { Sql } from 'postgres';

import type { Auth } from '../auth/auth.ts';
import { findOrganizationMember } from '../auth/membership.ts';
import { resolveUserOrganization } from '../domains/organizations/service.ts';
import { RateLimitExceededError, checkIpRateLimit } from '../lib/rate-limit.ts';
import type { RestEnv } from './shared.ts';
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
 * per-IP rate limiting on the shared `rest:api` rule, and coded JSON
 * errors.
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

export function createRestV1Routes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  // ---- the door: rate limit → API key → org resolution → role ------------
  app.use(async (c, next) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      'unknown';
    try {
      await checkIpRateLimit(deps.sql, 'rest:api', ip);
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        return c.json({ error: 'Rate limit exceeded' }, 429, {
          'retry-after': String(Math.ceil(error.retryAfter / 1000)),
        });
      }
      throw error;
    }

    const header = c.req.header('authorization') ?? '';
    if (!header.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }
    const apiKey = header.slice('Bearer '.length).trim();
    if (apiKey === '') {
      return c.json({ error: 'Empty API key' }, 401);
    }
    const syntheticHeaders = new Headers();
    syntheticHeaders.set('x-api-key', apiKey);
    const session = await deps.auth.api
      .getSession({ headers: syntheticHeaders })
      .catch(() => null);
    if (!session?.user) {
      return c.json({ error: 'Invalid API key' }, 401);
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
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to resolve organization';
      return c.json({ error: message }, 400);
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
