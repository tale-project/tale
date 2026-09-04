/**
 * Cookie-authenticated ORACLE for the platform web tier.
 *
 * The one door the Bun web process (`services/platform/server.ts`) needs but
 * cannot answer itself: it terminates the `/events/file` SSE fan-out and has
 * no database of its own, so it forwards the request's Cookie header here and
 * acts on the verdict. It was a Convex http action until the backend took
 * over the API tier. (A second oracle, the live-browser screencast's, left
 * with the feature: 0.5 never grew a viewer for it, and its session resolver
 * keyed on owner types 0.5 never creates, so it could only ever answer 409.)
 *
 * It authenticates the FORWARDED cookie itself rather than riding
 * `requireSession`: the refusals carry `Vary: Cookie` + `Cache-Control:
 * no-store` (a TLS-terminating proxy must never cache a 401 against the URL
 * and starve a freshly-logged-in user), and the IP rate limit runs BEFORE the
 * session lookup so an anonymous flood cannot force one session query per
 * request.
 */

import { Hono } from 'hono';
import type { Sql } from 'postgres';

import { loadTrustedProxies, type Auth } from '../auth/auth.ts';
import { getUserOrganizations } from '../auth/membership.ts';
import { getClientIp } from '../core/lib/utils/client_ip.ts';
import { rateLimitedPlainResponse } from '../lib/rate-limit-response.ts';
import { checkIpRateLimit, RateLimitExceededError } from '../lib/rate-limit.ts';

/**
 * Headers every answer carries: never cached, and keyed by the caller's
 * cookie when it is.
 *
 * A FUNCTION, not a shared constant: a header init object handed to
 * `new Response(...)` must not be reused across responses — the server
 * writes computed entries (content-length) back into it, so a second
 * response built from the same object inherits the FIRST one's length and
 * its body arrives truncated. Every call site gets a fresh object.
 */
function noStore(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Cache-Control': 'no-store', Vary: 'Cookie', ...extra };
}

/** JSON answer with {@link noStore} headers. Built directly rather than
 *  through `c.json(body, status, headers)` so every response in this module —
 *  the refusals included — is assembled the same way, and the browser-facing
 *  status/header contract is visible at each call site. */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: noStore({ 'Content-Type': 'application/json' }),
  });
}

/** 256 is a SOFT cap — there is no hard platform-side limit on per-user
 *  memberships. Anyone past it is an operator / service account, not a
 *  regular subject; we log the truncation so it is observable rather than a
 *  silently narrowed SSE fan-out. */
const MEMBERSHIP_SOFT_CAP = 256;

interface OracleDeps {
  sql: Sql;
  auth: Auth;
}

/**
 * Rate-limit by client IP, then resolve the session from the forwarded
 * cookie. Returns the session user, or the Response to send back.
 */
async function authenticateForwardedCookie(
  deps: OracleDeps,
  headers: Headers,
  limit: 'security:sse-auth',
): Promise<{ user: { id: string; email: string } } | Response> {
  const trusted = await loadTrustedProxies();
  const ip = getClientIp(headers, trusted);
  try {
    await checkIpRateLimit(deps.sql, limit, ip);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return rateLimitedPlainResponse(error, noStore());
    }
    throw error;
  }

  const session = await deps.auth.api.getSession({ headers });
  if (!session?.user) {
    return new Response('Unauthenticated', {
      status: 401,
      headers: noStore({ 'WWW-Authenticate': 'Cookie' }),
    });
  }
  return { user: session.user };
}

/**
 * `GET /api/sse/auth` — which org slugs may this session receive file events
 * for? The web tier drops every event whose `orgSlug` is not in the returned
 * set BEFORE any wire payload reaches the client.
 */
export function createSseAuthRoutes(deps: OracleDeps): Hono {
  const app = new Hono();

  app.get('/auth', async (c) => {
    const authenticated = await authenticateForwardedCookie(
      deps,
      c.req.raw.headers,
      'security:sse-auth',
    );
    if (authenticated instanceof Response) return authenticated;

    const memberships = await getUserOrganizations(
      deps.sql,
      authenticated.user.id,
    );
    if (memberships.length >= MEMBERSHIP_SOFT_CAP) {
      console.warn(
        `[/api/sse/auth] user has ${memberships.length} memberships (soft cap ${MEMBERSHIP_SOFT_CAP})`,
        { userId: authenticated.user.id },
      );
    }
    // A soft-removed member (`role = 'disabled'`) keeps no event access:
    // without this filter they would still receive file events for the org
    // they were kicked out of until the row is hard-deleted.
    const orgIds = memberships
      .filter((m) => m.role !== 'disabled')
      .slice(0, MEMBERSHIP_SOFT_CAP)
      .map((m) => m.organizationId);

    const orgSlugs =
      orgIds.length === 0
        ? []
        : (
            await deps.sql<{ slug: string }[]>`
              SELECT "slug" FROM "organization" WHERE "id" = ANY(${orgIds})
            `
          )
            .map((row) => row.slug)
            .filter((slug) => slug !== null && slug !== '');

    return jsonResponse({ userId: authenticated.user.id, orgSlugs }, 200);
  });

  return app;
}
