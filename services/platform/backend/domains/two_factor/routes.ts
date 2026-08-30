import { Hono } from 'hono';
import type { Sql } from 'postgres';

import type { Auth } from '../../auth/auth.ts';
import { requireSession, type AuthEnv } from '../../auth/session.ts';
import { getTwoFactorWireStatus } from './service.ts';

/**
 * /api/app/two-factor — the user-scoped (org-independent) 2FA status the
 * dashboard gate, the enroll page, and the settings surface read: the 0.4
 * `two_factor/queries:getStatus` shape verbatim. Enrollment itself stays on
 * Better Auth's own `/api/auth/two-factor/*` endpoints.
 */
export function createTwoFactorRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use(requireSession(deps.auth));

  app.get('/status', async (c) => {
    const userId = c.get('sessionBundle').user.id;
    return c.json(await getTwoFactorWireStatus(deps.sql, userId));
  });

  return app;
}
