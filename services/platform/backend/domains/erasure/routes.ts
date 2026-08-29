import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  cancelErasure,
  ErasureError,
  listErasureRequests,
  requestErasure,
  retryErasure,
  extendErasureDeadline,
  getErasureRequest,
} from './service.ts';

/** /api/app/erasure — GDPR Art 17 receipts (admin-gated in the service). */
function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof ErasureError) {
    return c.json(
      { ...error.data, error: error.code, message: error.message },
      error.status,
    );
  }
  throw error;
}

export function createErasureRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.get('/', async (c) => {
    const limitParam = Number(c.req.query('limit') ?? '100');
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(1, limitParam), 200)
      : 100;
    const statusesParam = c.req.query('statuses');
    const statuses =
      statusesParam !== undefined && statusesParam !== ''
        ? statusesParam.split(',')
        : undefined;
    const cursorTs = Number(c.req.query('cursorTs') ?? Number.NaN);
    const cursorId = c.req.query('cursorId');
    const requests = await listErasureRequests(deps.sql, c.get('orgId'), {
      limit,
      ...(statuses !== undefined ? { statuses } : {}),
      ...(Number.isFinite(cursorTs) && cursorId !== undefined
        ? { cursor: { ts: cursorTs, id: cursorId } }
        : {}),
    });
    const last = requests.at(-1);
    return c.json({
      requests,
      nextCursor:
        requests.length === limit && last !== undefined
          ? { ts: last.requestedAt, id: last._id }
          : null,
    });
  });

  app.post('/', async (c) => {
    const body = z
      .object({
        targetUserId: z.string().min(1).max(128),
        reason: z.string().min(1).max(2_000),
        reasonCode: z.string().min(1).max(64),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      return c.json(
        await requestErasure(deps.sql, {
          organizationId: c.get('orgId'),
          actorId: c.get('sessionBundle').user.id,
          actorEmail: c.get('sessionBundle').user.email,
          targetUserId: body.data.targetUserId,
          reason: body.data.reason,
          reasonCode: body.data.reasonCode,
        }),
        201,
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:requestId/cancel', async (c) => {
    const body = z
      .object({ reason: z.string().min(1).max(2_000) })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await cancelErasure(deps.sql, {
        organizationId: c.get('orgId'),
        actorId: c.get('sessionBundle').user.id,
        requestId: c.req.param('requestId'),
        reason: body.data.reason,
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:requestId/retry', async (c) => {
    try {
      await retryErasure(deps.sql, {
        organizationId: c.get('orgId'),
        requestId: c.req.param('requestId'),
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:requestId', async (c) => {
    const detail = await getErasureRequest(
      deps.sql,
      c.get('orgId'),
      c.req.param('requestId'),
    );
    if (detail === null) {
      return c.json({ error: 'REQUEST_NOT_FOUND' }, 404);
    }
    return c.json(detail);
  });

  app.post('/:requestId/extend', async (c) => {
    const body = z
      .object({
        extraDays: z.number(),
        extensionReason: z.string().min(1).max(4000),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const session = c.get('sessionBundle');
    try {
      return c.json(
        await extendErasureDeadline(
          deps.sql,
          {
            organizationId: c.get('orgId'),
            userId: session.user.id,
            email: session.user.email,
          },
          { requestId: c.req.param('requestId'), ...body.data },
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
