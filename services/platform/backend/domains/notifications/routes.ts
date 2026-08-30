import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
  type NotificationScope,
} from './service.ts';

const listQuerySchema = z.object({
  cursorCreatedAt: z.coerce.number().int().positive().optional(),
  cursorId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function scopeOf(c: Context<OrgEnv>): NotificationScope {
  return {
    orgId: c.get('orgId'),
    userId: c.get('sessionBundle').user.id,
    role: c.get('orgMember').role,
  };
}

/**
 * /api/app/notifications — the org-audience bell. Session- and
 * org-membership-gated; `security` rows are filtered to admins inside the
 * service (role travels in the scope).
 */
export function createNotificationRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.get('/', async (c) => {
    const query = listQuerySchema.safeParse({
      cursorCreatedAt: c.req.query('cursorCreatedAt'),
      cursorId: c.req.query('cursorId'),
      limit: c.req.query('limit'),
    });
    if (!query.success) {
      return c.json({ error: 'invalid query' }, 400);
    }
    const { cursorCreatedAt, cursorId, limit } = query.data;
    const cursor =
      cursorCreatedAt !== undefined && cursorId !== undefined
        ? { createdAt: cursorCreatedAt, id: cursorId }
        : null;
    const result = await listNotifications(deps.sql, scopeOf(c), {
      cursor,
      ...(limit !== undefined ? { limit } : {}),
    });
    return c.json(result);
  });

  app.get('/unread-count', async (c) => {
    return c.json({ count: await unreadCount(deps.sql, scopeOf(c)) });
  });

  app.post('/read-all', async (c) => {
    const scope = scopeOf(c);
    await transactSerializable(deps.sql, (tx) => markAllRead(tx, scope));
    return c.json({ ok: true });
  });

  app.post('/:id/read', async (c) => {
    const id = c.req.param('id');
    const scope = scopeOf(c);
    await transactSerializable(deps.sql, (tx) => markRead(tx, scope, id));
    return c.json({ ok: true });
  });

  return app;
}
