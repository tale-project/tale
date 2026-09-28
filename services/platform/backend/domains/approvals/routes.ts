import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { ErasureError } from '../erasure/service.ts';
import { ApprovalError, decideApproval, getApproval } from './service.ts';

/**
 * /api/app/approvals — one-row read + the generic decision, both
 * org-member operations (the 0.4 posture); review-gate rows refuse toward
 * their dedicated respond doors, and erasure rows additionally demand an
 * org-admin decider (the dual-control half of the GDPR contract) — the
 * service checks the session-resolved role per KIND. The 0.4 inbox
 * listing and per-status counts have no 0.5 consumer and are not served.
 */

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof ApprovalError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  // The erasure dispatch enforces filer ≠ approver at the write; surface its
  // refusal with the 0.4 code instead of a 500.
  if (error instanceof ErasureError) {
    return c.json({ error: error.code, message: error.message }, error.status);
  }
  throw error;
}

export function createApprovalRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

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
          role: c.get('orgMember').role,
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
