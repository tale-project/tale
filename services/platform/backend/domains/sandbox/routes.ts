import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { pinSession, teardownSession } from './service.ts';
import { listRunningOpsBySession, listSessionsForOrg } from './sessions.ts';

/**
 * /api/app/sandbox — the sandbox-management surface: the org's live
 * sessions (with their running ops), always-on pinning, and explicit
 * teardown. Administering sandbox compute is org configuration, so every
 * route is gated on the `orgSettings` write capability.
 */

const pinSchema = z.object({ pinned: z.boolean() });

function requireAdmin(c: Context<OrgEnv>): Response | null {
  const allowed = defineAbilityFor(c.get('orgMember').role).can(
    'write',
    'orgSettings',
  );
  return allowed ? null : c.json({ error: 'admin capability required' }, 403);
}

export function createSandboxRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.get('/sessions', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const sessions = await listSessionsForOrg(deps.sql, c.get('orgId'));
    const withOps = await Promise.all(
      sessions.map(async (session) =>
        Object.assign(
          {
            runningOps: await listRunningOpsBySession(
              deps.sql,
              session.sessionId,
            ),
          },
          session,
        ),
      ),
    );
    return c.json({ sessions: withOps });
  });

  app.post('/sessions/:sessionId/pin', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const body = pinSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const pinned = await pinSession(deps.sql, {
      organizationId: c.get('orgId'),
      sessionId: c.req.param('sessionId'),
      pinned: body.data.pinned,
    });
    return pinned
      ? c.json({ pinned: body.data.pinned })
      : c.json({ error: 'session not found' }, 404);
  });

  app.post('/sessions/:sessionId/destroy', async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const destroyed = await teardownSession(deps.sql, {
      organizationId: c.get('orgId'),
      sessionId: c.req.param('sessionId'),
    });
    return destroyed
      ? c.json({ destroyed: true })
      : c.json({ error: 'session not found' }, 404);
  });

  return app;
}
