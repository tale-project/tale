import type { MiddlewareHandler } from 'hono';

import type { Auth } from './auth.ts';
import { headersWithMintedCookie } from './minted-cookie.ts';
import { authRequestCache, soleCookieValue } from './request-cache.ts';

/**
 * The subset of Better Auth's session bundle the backend consumes. Kept
 * structural (not the library's full inferred type) so handlers depend on
 * what they actually read.
 */
export interface SessionBundle {
  user: { id: string; email: string; name: string };
  session: { id: string; activeOrganizationId?: string | null };
}

export interface AuthEnv {
  Variables: {
    sessionBundle: SessionBundle;
  };
}

/** The name of the cookie Better Auth reads the session from, per instance. */
const sessionCookieNames = new WeakMap<Auth, Promise<string>>();

function sessionCookieName(auth: Auth): Promise<string> {
  let name = sessionCookieNames.get(auth);
  if (name === undefined) {
    name = auth.$context.then(
      (context) => context.authCookies.sessionToken.name,
    );
    sessionCookieNames.set(auth, name);
  }
  return name;
}

/** Reject with 401 unless the request carries a valid Better Auth session. */
export function requireSession<E extends AuthEnv>(
  auth: Auth,
): MiddlewareHandler<E> {
  return async (c, next) => {
    // A session minted on this very request (an authenticating proxy's
    // headers, no cookie yet) rides in as if the browser had sent it.
    const headers = headersWithMintedCookie(c.req.raw);
    // Better Auth's inferred session type is a structural superset of
    // SessionBundle, so plain assignment narrows without a cast.
    const resolve = async (): Promise<SessionBundle | null> =>
      auth.api.getSession({ headers });
    // The process's cache answers a session it resolved a moment ago,
    // keyed by the very cookie Better Auth reads (`request-cache.ts`).
    const cache = authRequestCache();
    const bundle =
      cache === null
        ? await resolve()
        : await cache.session(
            soleCookieValue(
              headers.get('cookie'),
              await sessionCookieName(auth),
            ),
            resolve,
          );
    if (!bundle) {
      // The one flat envelope every door speaks — `code` beside the
      // sentence — where the session doors used to answer a bare
      // `{"error":"unauthorized"}` a client branching on `code` could not
      // read (2026-09-14 evaluation, h8).
      return c.json(
        {
          error:
            'Missing or invalid session — sign in, or send an API key as "Authorization: Bearer <key>" to the REST API under /api/v1',
          code: 'UNAUTHORIZED',
        },
        401,
        { 'cache-control': 'no-store' },
      );
    }
    c.set('sessionBundle', bundle);
    return next();
  };
}
