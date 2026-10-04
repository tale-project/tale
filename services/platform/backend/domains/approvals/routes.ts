import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { invalidBodyResponse } from '../../lib/invalid-body-response.ts';
import { runControlAccess } from '../automations/project-visibility.ts';
import { getRun } from '../automations/store.ts';
import { ErasureError } from '../erasure/service.ts';
import { getProjectAuthContext } from '../projects/service.ts';
import {
  ApprovalError,
  decideApproval,
  getApproval,
  type ApprovalRow,
} from './service.ts';

/**
 * A connector-operation approval a workflow run parked on carries the run in
 * `metadata.runId`, so it FOLLOWS that run's project boundary: reading it needs
 * the run's project read access, deciding it (approve/reject) the run's project
 * write access — the run's control gate (`runControlAccess`). A `runId` that
 * resolves to no run in this organization fails closed (UUID knowledge is not
 * authorization); a genuinely non-run approval (erasure, conversation, a chat
 * connector write with no run) keeps the org-member posture.
 *
 * Returns the gate to apply: `none` for a non-run approval, else the run's
 * `runControlAccess` (`hidden` when the run is missing/foreign/unreadable).
 */
async function approvalRunGate(
  sql: Sql,
  c: Context<OrgEnv>,
  approval: ApprovalRow,
): Promise<'none' | 'ok' | 'hidden' | 'forbidden'> {
  // Other kinds own their run metadata: task_review names a project-agent
  // run, whose decision belongs to the task's dedicated review door.
  if (approval.resourceType !== 'connector_operation') return 'none';
  const runId = approval.metadata?.runId;
  if (typeof runId !== 'string' || runId === '') return 'none';
  const run = await getRun(sql, c.get('orgId'), runId);
  // A named but missing/foreign run is not an org-wide approval: fail closed.
  if (run === null) return 'hidden';
  const auth = await getProjectAuthContext(sql, {
    organizationId: c.get('orgId'),
    userId: c.get('sessionBundle').user.id,
    role: c.get('orgMember').role,
  });
  return runControlAccess(sql, auth, run);
}

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
    // A run-bound approval reveals nothing to someone who cannot read its run's
    // project — it answers exactly like a missing approval.
    const gate = await approvalRunGate(deps.sql, c, approval);
    if (gate === 'hidden') {
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
    if (!body.success) return invalidBodyResponse(c, body.error);
    try {
      // Deciding a run-bound approval is a WRITE on its run's project: a member
      // who cannot read the run does not learn it exists (404), and one who can
      // read but not write it is refused (403) — kind-specific and dual-control
      // checks still run inside decideApproval for non-run kinds.
      const existing = await getApproval(
        deps.sql,
        c.get('orgId'),
        c.req.param('id'),
      );
      if (existing) {
        const gate = await approvalRunGate(deps.sql, c, existing);
        if (gate === 'hidden') {
          return c.json(
            { error: 'NOT_FOUND', message: 'Approval not found' },
            404,
          );
        }
        if (gate === 'forbidden') {
          return c.json(
            { error: 'RBAC_FORBIDDEN', message: 'Editor role required' },
            403,
          );
        }
      }
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
