import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  ApprovalError,
  countApprovalsByStatus,
  decideApproval,
  getApproval,
  listApprovals,
} from './service.ts';

/**
 * /api/app/approvals — the approvals inbox. Reads and the generic decision
 * are org-member operations (the 0.4 posture); review-gate rows refuse
 * toward their dedicated respond doors.
 */

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof ApprovalError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

const STATUSES = ['pending', 'executing', 'completed', 'rejected'] as const;
const statusSchema = z.enum(STATUSES);

export function createApprovalRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.get('/', async (c) => {
    const status = c.req.query('status');
    const excludeStatus = c.req.query('excludeStatus');
    if (
      (status !== undefined && !statusSchema.safeParse(status).success) ||
      (excludeStatus !== undefined &&
        !statusSchema.safeParse(excludeStatus).success)
    ) {
      return c.json({ error: 'invalid status filter' }, 400);
    }
    const limitRaw = Number(c.req.query('limit') ?? '30');
    const result = await listApprovals(deps.sql, c.get('orgId'), {
      ...(status !== undefined ? { status } : {}),
      ...(excludeStatus !== undefined ? { excludeStatus } : {}),
      ...(c.req.query('resourceType') !== undefined
        ? { resourceType: c.req.query('resourceType') ?? '' }
        : {}),
      cursor: c.req.query('cursor') ?? null,
      limit: Number.isFinite(limitRaw) ? limitRaw : 30,
    });
    return c.json(result);
  });

  app.get('/counts', async (c) => {
    return c.json({
      byStatus: await countApprovalsByStatus(deps.sql, c.get('orgId')),
    });
  });

  app.get('/:id', async (c) => {
    const approval = await getApproval(
      deps.sql,
      c.get('orgId'),
      c.req.param('id'),
    );
    if (!approval) {
      return c.json({ error: 'NOT_FOUND', message: 'Approval not found' }, 404);
    }
    return c.json(approval);
  });

  /** Approve (→ executing) or reject a pending approval. */
  app.post('/:id/decide', async (c) => {
    const body = z
      .object({
        status: z.enum(['executing', 'rejected']),
        comments: z.string().max(10_000).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await decideApproval(deps.sql, {
        organizationId: c.get('orgId'),
        approvalId: c.req.param('id'),
        status: body.data.status,
        ...(body.data.comments !== undefined
          ? { comments: body.data.comments }
          : {}),
        actor: {
          userId: c.get('sessionBundle').user.id,
          email: c.get('sessionBundle').user.email,
        },
      });
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
