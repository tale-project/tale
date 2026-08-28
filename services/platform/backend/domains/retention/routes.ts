import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';

import type { Auth } from '../../auth/auth.ts';
import { isAdminRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  applyRetentionBounds,
  getAppliedBounds,
  RetentionError,
} from './service.ts';

/** /api/app/retention — the admin bounds surface: what is applied, and the
 * Apply gesture that snapshots the current file × env bounds. */
function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof RetentionError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

export function createRetentionRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));
  app.use(async (c, next) => {
    if (!isAdminRole(c.get('orgMember').role)) {
      return c.json({ error: 'admin role required' }, 403);
    }
    return next();
  });

  app.get('/bounds', async (c) => {
    return c.json({
      applied: await getAppliedBounds(deps.sql, c.get('orgId')),
    });
  });

  app.post('/bounds/apply', async (c) => {
    try {
      return c.json({
        bounds: await applyRetentionBounds(deps.sql, {
          organizationId: c.get('orgId'),
          actorId: c.get('sessionBundle').user.id,
          actorEmail: c.get('sessionBundle').user.email,
        }),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
