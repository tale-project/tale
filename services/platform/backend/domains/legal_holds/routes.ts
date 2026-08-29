import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { isAdminRole } from '../../auth/membership.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  closeLegalMatter,
  GovernanceTailError,
  listLegalMatters,
  upsertLegalMatter,
} from '../governance/settings-tail.ts';
import {
  listActiveHoldTargetIds,
  approveLegalHoldRelease,
  LegalHoldError,
  listLegalHolds,
  placeLegalHold,
  rejectLegalHoldRelease,
  requestLegalHoldRelease,
  getLegalHoldByTarget,
  listReleaseRequestViews,
} from './service.ts';

/** /api/app/legal-holds — the admin preservation surface (the service
 * enforces the admin role on every write). */
function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof LegalHoldError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

export function createLegalHoldRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const actor = (c: Context<OrgEnv>) => ({
    organizationId: c.get('orgId'),
    actorId: c.get('sessionBundle').user.id,
    actorEmail: c.get('sessionBundle').user.email,
  });

  app.get('/', async (c) => {
    const statusParam = c.req.query('status');
    const status =
      statusParam === 'active' ||
      statusParam === 'released' ||
      statusParam === 'all'
        ? statusParam
        : undefined;
    const targetType = c.req.query('targetType');
    return c.json({
      holds: await listLegalHolds(deps.sql, c.get('orgId'), {
        ...(status !== undefined ? { status } : {}),
        ...(targetType !== undefined ? { targetType } : {}),
      }),
    });
  });

  /** One entity's hold status (member = stripped view). */
  app.get('/by-target', async (c) => {
    const targetType = c.req.query('targetType') ?? '';
    const targetId = c.req.query('targetId') ?? '';
    if (targetType === '' || targetId === '') {
      return c.json({ error: 'targetType and targetId required' }, 400);
    }
    return c.json({
      hold: await getLegalHoldByTarget(
        deps.sql,
        {
          organizationId: c.get('orgId'),
          isAdmin: isAdminRole(c.get('orgMember').role),
        },
        { targetType, targetId },
      ),
    });
  });

  /** Release requests with resolved names (admin surface). */
  app.get('/release-requests', async (c) => {
    if (!isAdminRole(c.get('orgMember').role)) {
      return c.json({ error: 'FORBIDDEN' }, 403);
    }
    const limitParam = Number(c.req.query('limit') ?? '100');
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(1, limitParam), 200)
      : 100;
    const status = c.req.query('status');
    const cursorTs = Number(c.req.query('cursorTs') ?? Number.NaN);
    const cursorId = c.req.query('cursorId');
    const requests = await listReleaseRequestViews(deps.sql, c.get('orgId'), {
      limit,
      ...(status !== undefined ? { status } : {}),
      ...(Number.isFinite(cursorTs) && cursorId !== undefined
        ? { cursor: { ts: cursorTs, id: cursorId } }
        : {}),
    });
    const last = requests.at(-1);
    return c.json({
      requests,
      // Keyset handle for the paginated history walk; null = exhausted.
      nextCursor:
        requests.length === limit && last !== undefined
          ? { ts: last.requestedAt, id: last._id }
          : null,
    });
  });

  /** Legal matters (grouping for holds). */
  app.get('/matters', async (c) => {
    if (!isAdminRole(c.get('orgMember').role)) {
      return c.json({ error: 'FORBIDDEN' }, 403);
    }
    const statusParam = c.req.query('status');
    const status =
      statusParam === 'open' ||
      statusParam === 'closed' ||
      statusParam === 'all'
        ? statusParam
        : undefined;
    return c.json({
      matters: await listLegalMatters(
        deps.sql,
        c.get('orgId'),
        status !== undefined ? { status } : {},
      ),
    });
  });

  app.post('/matters', async (c) => {
    if (!isAdminRole(c.get('orgMember').role)) {
      return c.json({ error: 'FORBIDDEN' }, 403);
    }
    const body = z
      .object({
        matterId: z.string().min(1).optional(),
        name: z.string().min(1).max(300),
        caseNumber: z.string().max(200).optional(),
        description: z.string().max(4000).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const session = c.get('sessionBundle');
    try {
      const matterId = await transactSerializable(deps.sql, (tx) =>
        upsertLegalMatter(
          tx,
          {
            organizationId: c.get('orgId'),
            userId: session.user.id,
            email: session.user.email,
          },
          body.data,
        ),
      );
      return c.json({ matterId });
    } catch (error) {
      return handleTailError(c, error);
    }
  });

  app.post('/matters/:matterId/close', async (c) => {
    if (!isAdminRole(c.get('orgMember').role)) {
      return c.json({ error: 'FORBIDDEN' }, 403);
    }
    const body = z
      .object({ releaseReason: z.string().max(2000).optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const session = c.get('sessionBundle');
    try {
      const result = await transactSerializable(deps.sql, (tx) =>
        closeLegalMatter(
          tx,
          {
            organizationId: c.get('orgId'),
            userId: session.user.id,
            email: session.user.email,
          },
          { matterId: c.req.param('matterId'), ...body.data },
        ),
      );
      return c.json(result);
    } catch (error) {
      return handleTailError(c, error);
    }
  });

  // Member-readable badge read (the 0.4 `listActiveHoldTargetIds`).
  app.get('/targets', async (c) => {
    const targetType = c.req.query('targetType') ?? '';
    if (targetType === '') return c.json({ error: 'targetType required' }, 400);
    return c.json(
      await listActiveHoldTargetIds(deps.sql, c.get('orgId'), targetType),
    );
  });

  app.post('/', async (c) => {
    const body = z
      .object({
        targetType: z.enum(['org', 'userMembership']),
        targetId: z.string().min(1).max(128),
        reason: z.string().min(1).max(2_000),
        matterRef: z.string().min(1).max(128).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      const holdId = await placeLegalHold(deps.sql, {
        ...actor(c),
        targetType: body.data.targetType,
        targetId: body.data.targetId,
        reason: body.data.reason,
        matterRef: body.data.matterRef,
      });
      return c.json({ holdId }, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:holdId/release-requests', async (c) => {
    const body = z
      .object({ reason: z.string().min(1).max(2_000) })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      const requestId = await requestLegalHoldRelease(deps.sql, {
        ...actor(c),
        holdId: c.req.param('holdId'),
        reason: body.data.reason,
      });
      return c.json({ requestId }, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/release-requests/:requestId/approve', async (c) => {
    try {
      return c.json(
        await approveLegalHoldRelease(deps.sql, {
          ...actor(c),
          requestId: c.req.param('requestId'),
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/release-requests/:requestId/reject', async (c) => {
    const body = z
      .object({ reason: z.string().max(2_000).optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await rejectLegalHoldRelease(deps.sql, {
        ...actor(c),
        requestId: c.req.param('requestId'),
        ...(body.data.reason !== undefined ? { reason: body.data.reason } : {}),
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}

function handleTailError(c: Context<OrgEnv>, error: unknown): Response {
  if (error instanceof GovernanceTailError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}
