import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { authorizeRls } from '../../auth/access.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { listAuditLogs, type AuditLogFilter } from './service.ts';
import { AUDIT_LOG_CATEGORIES, AUDIT_LOG_STATUSES } from './types.ts';

const listQuerySchema = z.object({
  category: z.enum(AUDIT_LOG_CATEGORIES).optional(),
  actorId: z.string().min(1).optional(),
  resourceType: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
  status: z.enum(AUDIT_LOG_STATUSES).optional(),
  startDate: z.coerce.number().int().positive().optional(),
  endDate: z.coerce.number().int().positive().optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursorTs: z.coerce.number().int().positive().optional(),
  cursorId: z.string().min(1).optional(),
});

/**
 * /api/app/audit-logs — the compliance read surface. Row access follows the
 * role matrix (`authorizeRls`: every active role reads, `disabled` cannot —
 * the middleware already rejects disabled members). Export/integrity-verify
 * surfaces land with the governance tooling (ledger).
 */
export function createAuditLogRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.get('/', async (c: Context<OrgEnv>) => {
    if (!authorizeRls(c.get('orgMember').role, 'auditLogs', 'read')) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const query = listQuerySchema.safeParse({
      category: c.req.query('category'),
      actorId: c.req.query('actorId'),
      resourceType: c.req.query('resourceType'),
      resourceId: c.req.query('resourceId'),
      status: c.req.query('status'),
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      search: c.req.query('search'),
      limit: c.req.query('limit'),
      cursorTs: c.req.query('cursorTs'),
      cursorId: c.req.query('cursorId'),
    });
    if (!query.success) {
      return c.json({ error: 'invalid query' }, 400);
    }
    const { limit, cursorTs, cursorId, ...filter } = query.data;
    const cleanFilter: AuditLogFilter = Object.fromEntries(
      Object.entries(filter).filter(([, value]) => value !== undefined),
    );
    const result = await listAuditLogs(deps.sql, c.get('orgId'), {
      filter: cleanFilter,
      ...(limit !== undefined ? { limit } : {}),
      cursor:
        cursorTs !== undefined && cursorId !== undefined
          ? { ts: cursorTs, id: cursorId }
          : null,
    });
    return c.json(result);
  });

  return app;
}
