import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { authorizeRls } from '../../auth/access.ts';
import type { Auth } from '../../auth/auth.ts';
import { isAdminRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  browserFacing,
  s3PresignGetUrl,
  s3PutObject,
} from '../../core/lib/storage/object_store.ts';
import { resolveObjectStore } from '../../lib/object-store.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { listBlockCounters } from '../login_attempts/service.ts';
import {
  buildAuditExport,
  getActivitySummary,
  getAuditLogById,
  listAuditLogs,
  type AuditLogFilter,
} from './service.ts';
import { AUDIT_LOG_CATEGORIES, AUDIT_LOG_STATUSES } from './types.ts';
import { getIntegrityStatus, verifyAuditChain } from './verify.ts';

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

  /** Errors-only lane (status failure/denied) — same keyset envelope. */
  /** Sign-in block activity (admin) — the security page's table. */
  app.get('/block-counters', async (c: Context<OrgEnv>) => {
    if (!isAdminRole(c.get('orgMember').role)) {
      return c.json({ error: 'FORBIDDEN' }, 403);
    }
    const limitRaw = Number(c.req.query('limit') ?? '200');
    return c.json({
      counters: await listBlockCounters(
        deps.sql,
        c.get('orgId'),
        Number.isFinite(limitRaw) ? limitRaw : 200,
      ),
    });
  });

  app.get('/errors', async (c: Context<OrgEnv>) => {
    if (!authorizeRls(c.get('orgMember').role, 'auditLogs', 'read')) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const limitParsed = listQuerySchema.shape.limit.safeParse(
      c.req.query('limit'),
    );
    if (!limitParsed.success) {
      return c.json({ error: 'invalid query' }, 400);
    }
    const limitParam = limitParsed.data;
    const cursorTs = Number(c.req.query('cursorTs') ?? Number.NaN);
    const cursorId = c.req.query('cursorId');
    const categoryParsed = z
      .enum(AUDIT_LOG_CATEGORIES)
      .optional()
      .safeParse(c.req.query('category'));
    const category = categoryParsed.success ? categoryParsed.data : undefined;
    const result = await listAuditLogs(deps.sql, c.get('orgId'), {
      onlyErrors: true,
      ...(category !== undefined ? { filter: { category } } : {}),
      ...(limitParam !== undefined ? { limit: limitParam } : {}),
      cursor:
        Number.isFinite(cursorTs) && cursorId !== undefined
          ? { ts: cursorTs, id: cursorId }
          : null,
    });
    return c.json(result);
  });

  app.get('/summary', async (c: Context<OrgEnv>) => {
    if (!authorizeRls(c.get('orgMember').role, 'auditLogs', 'read')) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const periodParam = Number(c.req.query('periodDays') ?? '7');
    return c.json(
      await getActivitySummary(
        deps.sql,
        c.get('orgId'),
        Number.isFinite(periodParam) ? { periodDays: periodParam } : {},
      ),
    );
  });

  app.get('/integrity/status', async (c: Context<OrgEnv>) => {
    if (!authorizeRls(c.get('orgMember').role, 'auditLogs', 'read')) {
      return c.json({ error: 'forbidden' }, 403);
    }
    return c.json({
      status: await getIntegrityStatus(deps.sql, c.get('orgId')),
    });
  });

  /** On-demand chain walk (admin click; a READ that works, so POST-free
   * would fit — but the walk is expensive, so it stays explicit). */
  app.post('/integrity/verify', async (c: Context<OrgEnv>) => {
    if (!authorizeRls(c.get('orgMember').role, 'auditLogs', 'read')) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const body = z
      .object({
        maxEntries: z.number().int().min(1).max(5_000).optional(),
        fromTimestamp: z.number().optional(),
        afterId: z.string().optional(),
        previousExpectedHash: z.string().optional(),
      })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    return c.json(await verifyAuditChain(deps.sql, c.get('orgId'), body.data));
  });

  /** CSV/JSON export → the org object store + a short-lived presigned GET
   * (the 0.4 `requestExport` {storageId, fileName, url} contract). */
  app.post('/export', async (c: Context<OrgEnv>) => {
    if (!isAdminRole(c.get('orgMember').role)) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const body = z
      .object({
        format: z.enum(['csv', 'json']),
        filter: z
          .object({
            category: z.string().optional(),
            actorId: z.string().optional(),
            resourceType: z.string().optional(),
            status: z.string().optional(),
            startDate: z.number().optional(),
            endDate: z.number().optional(),
            search: z.string().optional(),
          })
          .optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const orgSlug = await resolveOrgSlug(deps.sql, c.get('orgId'));
    if (orgSlug === null) return c.json({ error: 'ORG_NOT_FOUND' }, 404);
    const cleanFilter = body.data.filter
      ? Object.fromEntries(
          Object.entries(body.data.filter).filter(
            ([, value]) => value !== undefined,
          ),
        )
      : undefined;
    const built = await buildAuditExport(deps.sql, c.get('orgId'), {
      format: body.data.format,
      ...(cleanFilter !== undefined ? { filter: cleanFilter } : {}),
    });
    const store = await resolveObjectStore(orgSlug);
    const key = `orgs/${orgSlug}/audit-exports/${built.fileName}`;
    await s3PutObject(
      store,
      key,
      new TextEncoder().encode(built.content),
      built.contentType,
    );
    // The browser downloads the export directly, so the URL is signed
    // against the origin it can reach — see `browserFacing`.
    const url = await s3PresignGetUrl(browserFacing(store), key, {
      filename: built.fileName,
      expiresInSec: 600,
    });
    return c.json({ storageId: key, fileName: built.fileName, url });
  });

  /** One row (deep link / detail dialog). LAST: fixed paths win above. */
  app.get('/:logId', async (c) => {
    if (!authorizeRls(c.get('orgMember').role, 'auditLogs', 'read')) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const log = await getAuditLogById(
      deps.sql,
      c.get('orgId'),
      c.req.param('logId'),
    );
    if (log === null) return c.json({ error: 'LOG_NOT_FOUND' }, 404);
    return c.json({ log });
  });

  return app;
}
