/**
 * Cookie-authenticated ORACLES for the platform web tier.
 *
 * Two doors the Bun web process (`services/platform/server.ts`) needs but
 * cannot answer itself: it terminates two browser connections — the
 * `/events/file` SSE fan-out and the screencast WebSocket — and has no
 * database of its own, so it forwards the request's Cookie header here and
 * acts on the verdict. They were Convex http actions until the backend took
 * over the API tier.
 *
 * Both authenticate the FORWARDED cookie themselves rather than riding
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
import { loadProjectSharedThread } from '../domains/chat/threads.ts';
import { listLiveSessionsForOwner } from '../domains/sandbox/sessions.ts';
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
  limit: 'security:sse-auth' | 'security:screencast-auth',
): Promise<{ user: { id: string; email: string } } | Response> {
  const trusted = await loadTrustedProxies();
  const ip = getClientIp(headers, trusted);
  try {
    await checkIpRateLimit(deps.sql, limit, ip);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return new Response('Rate limit exceeded', {
        status: 429,
        headers: noStore({
          'Retry-After': String(Math.ceil(error.retryAfter / 1000)),
        }),
      });
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

/** The thread's live sandbox session, resolved for a viewer who has already
 *  passed the view boundary. `null` means "no running session" — the
 *  resume-to-view state, never an authorization failure. */
interface BrowsableSession {
  sessionId: string | null;
  status: string | null;
}

/**
 * Owner key resolution MUST match the session writers': a chat thread with
 * both an org and a user is user-owned (`<orgId>:<userId>`, so one sandbox
 * serves every thread of that person in that org), everything else is
 * thread-owned. Only LIVE incarnations count — the deterministic owner id is
 * reused across restarts, so terminal rows for the same owner are still
 * there.
 */
async function resolveBrowsableSession(
  sql: Sql,
  thread: { id: string; orgId: string; userId: string | null },
): Promise<BrowsableSession> {
  const userOwned = thread.userId !== null && thread.userId !== '';
  const ownerType = userOwned ? 'user' : 'thread';
  const ownerId = userOwned ? `${thread.orgId}:${thread.userId}` : thread.id;
  const rows = await listLiveSessionsForOwner(sql, ownerType, ownerId);
  const row = rows[0];
  return row
    ? { sessionId: row.sessionId, status: row.status }
    : { sessionId: null, status: null };
}

/**
 * `GET /api/sandbox/screencast-auth?threadId=…[&control=1]` — may this
 * session watch (or drive) the thread's live browser?
 *
 * The web tier propagates our status verbatim, so each one is part of the
 * browser-facing contract: 401 unauthenticated, 403 thread missing OR access
 * denied (conflated on purpose — 403 reveals nothing beyond "you can't have
 * it"), 409 `session_not_running` when there is nothing live to stream,
 * 429 over the IP limit.
 *
 * Writable control is a SEPARATE, stricter grant than view: only the thread
 * OWNER gets it, and only while the session is active. A denied control
 * request still streams read-only, so a second viewer watches while the
 * owner drives.
 */
export function createScreencastAuthRoutes(deps: OracleDeps): Hono {
  const app = new Hono();

  app.get('/screencast-auth', async (c) => {
    const threadId = c.req.query('threadId');
    if (!threadId) {
      return new Response('Missing threadId', {
        status: 400,
        headers: noStore(),
      });
    }

    const authenticated = await authenticateForwardedCookie(
      deps,
      c.req.raw.headers,
      'security:screencast-auth',
    );
    if (authenticated instanceof Response) return authenticated;
    const userId = authenticated.user.id;

    // The view boundary: the thread's own org decides, so resolve it from the
    // row rather than trusting a caller-supplied org.
    const threads = await deps.sql<
      { id: string; orgId: string; userId: string | null }[]
    >`
      SELECT t."id", t.org_id AS "orgId", t.user_id AS "userId"
      FROM app.threads t
      JOIN app.thread_metadata tm ON tm.thread_id = t.id
      WHERE t."id" = ${threadId} AND tm.status = 'active'
      LIMIT 1
    `;
    const thread = threads[0];
    const owner = thread !== undefined && thread.userId === userId;
    const visible =
      thread !== undefined &&
      (owner ||
        (await loadProjectSharedThread(
          deps.sql,
          thread.orgId,
          userId,
          threadId,
        )) !== null);
    if (thread === undefined || !visible) {
      console.debug('[/api/sandbox/screencast-auth] access denied', {
        threadId,
        userId,
      });
      return new Response('Forbidden', { status: 403, headers: noStore() });
    }

    const session = await resolveBrowsableSession(deps.sql, thread);
    // Only `active` gets a live screencast: the runnerd raw-VNC tunnel is
    // reachable once the session is up, not while it is creating or degraded.
    if (session.sessionId === null || session.status !== 'active') {
      return jsonResponse({ error: 'session_not_running' }, 409);
    }

    const control = c.req.query('control') === '1' && owner;
    return jsonResponse({ sessionId: session.sessionId, control }, 200);
  });

  return app;
}
