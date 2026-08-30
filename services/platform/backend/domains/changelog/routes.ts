import { Hono } from 'hono';
import type { Sql } from 'postgres';

import type { Auth } from '../../auth/auth.ts';
import { requireSession, type AuthEnv } from '../../auth/session.ts';
import { listReleases } from './service.ts';

/** /api/app/changelog — the in-app release viewer (session-gated; org-free
 * like the 0.4 action). */
export function createChangelogRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use(requireSession(deps.auth));

  app.get('/releases', async (c) => {
    const from = c.req.query('from');
    try {
      return c.json({
        releases: await listReleases(from !== undefined ? { from } : {}),
      });
    } catch (error) {
      console.warn('[changelog] releases fetch failed:', error);
      return c.json({ error: 'CHANGELOG_UNAVAILABLE' }, 502);
    }
  });

  return app;
}
