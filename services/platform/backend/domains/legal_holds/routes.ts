import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  approveLegalHoldRelease,
  LegalHoldError,
  listLegalHolds,
  placeLegalHold,
  rejectLegalHoldRelease,
  requestLegalHoldRelease,
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
    return c.json({ holds: await listLegalHolds(deps.sql, c.get('orgId')) });
  });

  app.post('/', async (c) => {
    const body = z
      .object({
        targetType: z.enum(['org', 'userMembership']),
        targetId: z.string().min(1).max(128),
        reason: z.string().min(1).max(2_000),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      const holdId = await placeLegalHold(deps.sql, {
        ...actor(c),
        targetType: body.data.targetType,
        targetId: body.data.targetId,
        reason: body.data.reason,
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
    try {
      await rejectLegalHoldRelease(deps.sql, {
        ...actor(c),
        requestId: c.req.param('requestId'),
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
