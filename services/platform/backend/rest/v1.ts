import { Hono, type Context, type Env } from 'hono';
import type { Sql } from 'postgres';

import {
  isValidOrgSlug,
  MAX_ORG_SLUG_LENGTH,
} from '../../lib/shared/constants/org-slug.ts';
import {
  API_KEY_RATE_LIMIT,
  loadTrustedProxies,
  type Auth,
} from '../auth/auth.ts';
import { findOrganizationMember } from '../auth/membership.ts';
import { getClientIp, nodePeerAddress } from '../core/lib/utils/client_ip.ts';
import { resolveUserOrganization } from '../domains/organizations/service.ts';
import { reportRequestError, requestIdOf } from '../error-reporting.ts';
import { rateLimitedResponse } from '../lib/rate-limit-response.ts';
import {
  RateLimitExceededError,
  checkIpRateLimit,
  checkUserRateLimit,
} from '../lib/rate-limit.ts';
import { domainErrorResponse, type RestEnv } from './shared.ts';
import { createAutomationRestRoutes } from './v1-automations.ts';
import { createRestBrowserSessionRoutes } from './v1-browser-sessions.ts';
import { createConversationRestRoutes } from './v1-conversations.ts';
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
 * multi-org key without the header is refused on EVERY route, reads
 * included, rather than guessed from the dashboard's last-active pointer —
 * a machine's answer must never depend on what a person last clicked),
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
 * the app surface uses; `public/openapi.json` documents their contract.
 * Project-owned resources take their project from the URL. Families live beside
 * this door: v1-core (contacts, products, documents, knowledge, agents,
 * skills), v1-automations (+ runs), v1-projects (folders, uploads, files),
 * v1-tasks (external-ref intake, comments, start), v1-threads (chat).
 * `/websites` rides the crawler family (v1-websites), `/browser-sessions`
 * is the operator door to the video-ingest cookie pool
 * (v1-browser-sessions), and `/api/v1/mcp` rides automations_builder
 * (v1-mcp); the automation webhook trigger lives at
 * `/api/automations/webhook/:token` for org-only automations and
 * `/api/projects/:id/automations/webhook/:token` for installed project
 * automations (app.ts). The token is their sole credential.
 */

/**
 * The door's 401: the flat envelope plus the `WWW-Authenticate` challenge
 * RFC 9110 §11.6.1 requires of every 401 — naming the Bearer scheme, with
 * RFC 6750 §3's `error="invalid_token"` when a key was presented and
 * refused (a request that presented nothing gets the bare challenge).
 */
function unauthorized(
  c: Context<RestEnv>,
  message: string,
  challenge: 'bearer' | 'invalid_token' = 'bearer',
): Response {
  return c.json({ error: message, code: 'UNAUTHORIZED' }, 401, {
    'www-authenticate':
      challenge === 'invalid_token' ? 'Bearer error="invalid_token"' : 'Bearer',
  });
}

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

  // Every non-2xx on this door is the one flat JSON envelope — including
  // the 500 an escaped error answers. The app-level handler's text/plain
  // `Internal Server Error` broke every client that read the body as JSON;
  // the error is still reported the same way, and the response carries the
  // request id a caller can quote. A thrown HTTPException (a body-size
  // middleware's 413, say) keeps its status but speaks the envelope too.
  app.onError((err, c) => {
    const requestId = requestIdOf(c);
    if ('getResponse' in err) {
      const refused = err.getResponse();
      // The exception's own headers ride along (a challenge, a wait) — its
      // text/plain body framing does not.
      const headers: Record<string, string> = {};
      refused.headers.forEach((value, name) => {
        if (name !== 'content-type' && name !== 'content-length') {
          headers[name] = value;
        }
      });
      return c.json(
        {
          error: err.message || refused.statusText || 'Request refused',
          code: refused.status === 413 ? 'BODY_TOO_LARGE' : 'HTTP_ERROR',
          ...(requestId === undefined ? {} : { requestId }),
        },
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an HTTPException carries a valid status
        refused.status as 400,
        headers,
      );
    }
    reportRequestError(err, c);
    return c.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        ...(requestId === undefined ? {} : { requestId }),
      },
      500,
    );
  });

  // Every answer on this door is per-caller and per-moment — a key holder's
  // own rows, a signed handoff, a turn's state — so nothing between the
  // caller and the door may cache it. Routes that set their own directive
  // (the attachment lane's `private, no-store`) keep it.
  app.use(async (c, next) => {
    await next();
    if (!c.res.headers.has('cache-control')) {
      c.res.headers.set('cache-control', 'no-store');
    }
  });

  // ---- the door: API key → key holder's budget → org resolution → role ---
  app.use(async (c, next) => {
    // RFC 9110 §11.1: the authentication scheme is case-insensitive —
    // `bearer` and `BEARER` name the same scheme as `Bearer`.
    const scheme = /^bearer\s+(.*)$/i.exec(c.req.header('authorization') ?? '');
    if (scheme === null) {
      return unauthorized(c, 'Missing or invalid Authorization header');
    }
    const apiKey = (scheme[1] ?? '').trim();
    if (apiKey === '') {
      return unauthorized(c, 'Empty API key');
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
      return unauthorized(c, 'Invalid API key', 'invalid_token');
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
    // A header that cannot be a slug at all names no organization: the
    // domain's own 404, answered here without a lookup and without echoing
    // an unbounded value back (the message used to quote whatever arrived).
    if (orgSlugHeader && !isValidOrgSlug(orgSlugHeader)) {
      const shown =
        orgSlugHeader.length > MAX_ORG_SLUG_LENGTH
          ? `${orgSlugHeader.slice(0, MAX_ORG_SLUG_LENGTH)}…`
          : orgSlugHeader;
      return c.json(
        {
          error: `Organization not found: ${shown}`,
          code: 'ORG_SLUG_INVALID',
        },
        404,
      );
    }
    let resolved;
    try {
      resolved = await resolveUserOrganization(deps.sql, {
        userId: session.user.id,
        ...(orgSlugHeader ? { orgSlug: orgSlugHeader } : {}),
        // A machine call must never follow the dashboard's last-active
        // pointer across tenants — multi-org keys say which org they mean,
        // on reads as on writes. (Reads used to fall back to the pointer
        // outside the project, task and conversation families, so a plain
        // `GET /contacts` answered whichever organization a person had last
        // opened in a browser — a tenancy hazard no client could defend
        // against, and one the contract denied.)
        requireExplicitOrgSlug: true,
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
        {
          error: `Not a member of organization "${resolved.orgSlug}".`,
          code: 'ORG_FORBIDDEN',
        },
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

  // No write on this door reads a query parameter — every argument of a
  // write is in its body, which is strict — so a query string on one is a
  // mistake to name (`DELETE /contacts/1?force=true` used to delete with
  // `force` silently ignored). Reads declare theirs route by route
  // (`readQuery`, `noQuery`).
  app.use(async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
    const [stray] = Object.keys(c.req.queries());
    if (stray === undefined) return next();
    return c.json(
      {
        error: `invalid query: "${stray}" — this route takes no query parameters`,
        code: 'INVALID_QUERY',
        data: {
          issues: Object.keys(c.req.queries()).map((path) => ({
            path,
            message: 'this route takes no query parameters',
          })),
        },
      },
      400,
    );
  });

  app.route('/', createCoreRoutes({ sql: deps.sql }));
  app.route('/', createConversationRestRoutes({ sql: deps.sql }));
  app.route('/', createProjectRestRoutes({ sql: deps.sql }));
  app.route('/', createTaskRestRoutes({ sql: deps.sql }));
  app.route('/', createThreadRestRoutes({ sql: deps.sql }));
  app.route('/', createAutomationRestRoutes({ sql: deps.sql }));
  app.route('/', createRestWebsiteRoutes({ sql: deps.sql }));
  app.route('/', createRestBrowserSessionRoutes({ sql: deps.sql }));
  app.route('/', createRestMcpRoutes({ sql: deps.sql }));

  return app;
}

const REST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * Which methods the door's families serve on a path — from the routes
 * they registered (middleware, registered as `ALL`, names no method). The
 * probe router matches the families' own patterns, so `/documents/:id`
 * and `/automations/:name` answer for any id without listing them.
 */
function methodsServedOn(door: Hono<RestEnv>): (path: string) => string[] {
  const probe = new Hono();
  for (const route of door.routes) {
    if (route.method === 'ALL') continue;
    probe.on(route.method, route.path, () => new Response(null));
  }
  return (path) => {
    const served = REST_METHODS.filter(
      (method) => (probe.router.match(method, path)[0] ?? []).length > 0,
    );
    // Hono answers HEAD with the GET handler, body dropped; the catch-all
    // below answers OPTIONS on every served path (and nothing at all on a
    // path nobody serves, which stays the 404).
    if (served.length === 0) return [];
    return served.includes('GET')
      ? [...served, 'HEAD', 'OPTIONS']
      : [...served, 'OPTIONS'];
  };
}

/**
 * Mount the door at `/api/v1`, followed by the JSON catch-all for a
 * request no family serves — every non-2xx on this door is the one flat
 * envelope, never the app's text/plain `404 Not Found`. A path a family
 * does serve, asked with a method it does not take, answers 405 with the
 * `Allow` list RFC 9110 §15.5.6 requires (an `OPTIONS` on it answers 204
 * with the same list); a path nobody serves answers 404. The catch-all
 * lives on the PARENT, registered after the families, so a served route
 * always wins and the door middleware (401 first) still runs ahead of it.
 */
export function mountRestV1Routes<E extends Env>(
  app: Hono<E>,
  deps: { sql: Sql; auth: Auth },
): void {
  const door = createRestV1Routes(deps);
  const servedOn = methodsServedOn(door);
  app.route('/api/v1', door);
  app.all('/api/v1/*', (c) => {
    const path = c.req.path.slice('/api/v1'.length) || '/';
    const allowed = servedOn(path);
    if (allowed.length === 0) {
      return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    }
    const allow = allowed.join(', ');
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204, { allow });
    }
    return c.json(
      {
        error: `Method ${c.req.method} is not allowed here — this path takes ${allow}`,
        code: 'METHOD_NOT_ALLOWED',
      },
      405,
      { allow },
    );
  });
}
