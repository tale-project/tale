import type { MiddlewareHandler } from 'hono';

import type { Auth } from './auth.ts';

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

/** Reject with 401 unless the request carries a valid Better Auth session. */
export function requireSession<E extends AuthEnv>(
  auth: Auth,
): MiddlewareHandler<E> {
  return async (c, next) => {
    // Better Auth's inferred session type is a structural superset of
    // SessionBundle, so plain assignment narrows without a cast.
    const bundle: SessionBundle | null = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
    if (!bundle) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    c.set('sessionBundle', bundle);
    return next();
  };
}
