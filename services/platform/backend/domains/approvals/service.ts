import type { Sql } from 'postgres';

import { isAdminRole } from '../../auth/membership.ts';
import { toJson } from '../../db/sql.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { lockRunInTx, pokeParkedRunInTx } from '../automations/store.ts';
import {
  confirmAndScheduleErasure,
  rejectErasure,
} from '../erasure/service.ts';

/**
 * The approvals read/decide surface — the 0.5 twin of the 0.4
 * `convex/approvals/{queries,mutations,helpers}` half that has a consumer:
 * one-row read and the generic human decision (`updateApprovalStatus`)
 * with the same FSM and the same dedicated-door refusals. Kind-scoped
 * authorization rides the decision: erasure rows demand an org admin
 * (`assertRoleMayDecideKind`). The gate half lives in `gate.ts`; the
 * conversations fold lives in the send lane.
 */

export class ApprovalError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 501;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 | 501 = 400,
  ) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
    this.status = status;
  }
}

export interface ApprovalRow {
  id: string;
  organizationId: string;
  resourceType: string;
  resourceId: string;
  priority: string;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  wfExecutionId: string | null;
  stepSlug: string | null;
  approvedBy: string | null;
  reviewedAt: number | null;
  threadId: string | null;
  messageId: string | null;
  executedAt: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

const APPROVAL_COLUMNS = `
  id, org_id AS "organizationId", resource_type AS "resourceType",
  resource_id AS "resourceId", priority, status,
  wf_execution_id AS "wfExecutionId", step_slug AS "stepSlug",
  approved_by AS "approvedBy", reviewed_at_ms::float8 AS "reviewedAt",
  thread_id AS "threadId", message_id AS "messageId",
  executed_at_ms::float8 AS "executedAt", metadata,
  created_at_ms::float8 AS "createdAt"
`;

export async function getApproval(
  sql: Sql,
  organizationId: string,
  approvalId: string,
): Promise<ApprovalRow | null> {
  const rows = await sql<ApprovalRow[]>`
    SELECT ${sql.unsafe(APPROVAL_COLUMNS)} FROM app.approvals
    WHERE id = ${approvalId} AND org_id = ${organizationId} LIMIT 1
  `;
  return rows[0] ?? null;
}

export interface DecideApprovalArgs {
  organizationId: string;
  approvalId: string;
  status: 'executing' | 'rejected';
  comments?: string;
  /** `role` is the caller's SESSION-RESOLVED org role (`orgMember.role`
   * from `requireOrgMember` — trusted-headers aware), never a raw member
   * row read. Kind-gated decisions check it. */
  actor: { userId: string; role: string; email?: string };
}

/**
 * The per-KIND authorization rule for the generic decide door. The door
 * itself is an org-member surface (the 0.4 posture — connector operations
 * and conversation approvals are decided by the people working the
 * thread), but a GDPR erasure decision IS the second half of
 * the dual-control contract the docs promise ("a second Admin must
 * approve"), so both deciding directions — approve AND reject — demand an
 * org admin. Pure so the rule is unit-testable.
 */
export function assertRoleMayDecideKind(
  resourceType: string,
  role: string,
): void {
  if (resourceType === 'erasure' && !isAdminRole(role)) {
    throw new ApprovalError(
      'FORBIDDEN',
      'Only org admins decide erasure approvals.',
      403,
    );
  }
}

/**
 * The approval kinds the generic door refuses, each naming the door that
 * settles it. A kind belongs here when something else owns its lifecycle —
 * a respond route, or the task it gates.
 */
const DEDICATED_RESPOND_DOORS: Readonly<Record<string, string>> = {
  document_record_review:
    'Controlled-record reviews are answered via the document records respond door.',
  task_review:
    'Task reviews are decided on the task: moving the card from In review to Done approves, moving it back to In progress sends the work back (the review gate is withdrawn).',
};

/**
 * The generic human decision — the 0.4 `updateApprovalStatus` twin. Valid
 * only from `pending`, only to `executing` (approve) or `rejected`;
 * `completed` is the execution path's to set. Review-gate rows refuse
 * toward their dedicated respond doors, whose permission checks and state
 * transitions a generic settle would bypass.
 *
 * A decided connector operation wakes the automation run parked behind it
 * in the same transaction, approved or rejected — the decision is the event,
 * and the run's own poll is only a backstop, minutes out. Both commit
 * together or neither does: a wake that cannot be queued fails the decision
 * unrecorded, so the reviewer's retry decides it again. (A wake sent after
 * the commit could fail with the decision already recorded: the reviewer
 * was told it failed, a retry met ALREADY_RESOLVED, and the run waited for
 * its poll.)
 *
 * The run's row is locked before the approval's: the run's terminal doors
 * lock the run first and its approvals after (`lockRunInTx`), so the
 * decision takes them in the same order — run, approval, audit chain.
 */
export async function decideApproval(
  sql: Sql,
  args: DecideApprovalArgs,
): Promise<void> {
  await sql.begin(async (tx) => {
    // Which run the decision wakes, read before any lock: an approval's
    // kind and run never change once it is minted.
    const facts = await tx<{ resourceType: string; runId: string | null }[]>`
      SELECT resource_type AS "resourceType", metadata->>'runId' AS "runId"
      FROM app.approvals
      WHERE id = ${args.approvalId} AND org_id = ${args.organizationId}
    `;
    const wakes =
      facts[0]?.resourceType === 'connector_operation' &&
      typeof facts[0].runId === 'string'
        ? { organizationId: args.organizationId, runId: facts[0].runId }
        : null;
    if (wakes !== null) await lockRunInTx(tx, wakes);

    const rows = await tx<
      {
        resourceType: string;
        resourceId: string;
        status: string;
        metadata: Record<string, unknown> | null;
      }[]
    >`
      SELECT resource_type AS "resourceType", resource_id AS "resourceId",
             status, metadata
      FROM app.approvals
      WHERE id = ${args.approvalId} AND org_id = ${args.organizationId}
      FOR UPDATE
    `;
    const approval = rows[0];
    if (!approval) {
      throw new ApprovalError('NOT_FOUND', 'Approval not found', 404);
    }
    // Rows with a dedicated settle path are NOT generically completable:
    // that path carries the permission checks, the feedback-required rule,
    // and the resource's own state transition.
    const dedicatedDoor = DEDICATED_RESPOND_DOORS[approval.resourceType];
    if (dedicatedDoor !== undefined) {
      throw new ApprovalError(
        'APPROVAL_REQUIRES_DEDICATED_RESPOND',
        dedicatedDoor,
        409,
      );
    }
    assertRoleMayDecideKind(approval.resourceType, args.actor.role);
    if (approval.status !== 'pending') {
      throw new ApprovalError(
        'ALREADY_RESOLVED',
        `This approval is already ${approval.status}`,
        409,
      );
    }

    const users = await tx<{ name: string | null; email: string | null }[]>`
      SELECT "name", "email" FROM "user" WHERE "id" = ${args.actor.userId}
      LIMIT 1
    `;
    const approverName = users[0]?.name?.trim() || users[0]?.email || undefined;

    await tx`
      UPDATE app.approvals SET
        status = ${args.status}, approved_by = ${args.actor.userId},
        reviewed_at_ms = ${Date.now()},
        metadata = ${tx.json(
          toJson({
            ...approval.metadata,
            ...(args.comments ? { comments: args.comments } : {}),
            ...(approverName ? { approverName } : {}),
          }),
        )}
      WHERE id = ${args.approvalId}
    `;

    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actor.userId,
      ...(args.actor.email !== undefined
        ? { actorEmail: args.actor.email }
        : {}),
      actorType: 'user',
      action:
        args.status === 'executing' ? 'approve_request' : 'reject_request',
      category: 'workflow',
      resourceType: 'approval',
      resourceId: args.approvalId,
      resourceName: approval.resourceType,
      previousState: { status: approval.status },
      newState: {
        status: args.status,
        ...(args.comments !== undefined ? { comments: args.comments } : {}),
      },
      status: 'success',
    });
    // GDPR Art 17 dispatch: approving an erasure row starts its cooling-off
    // window and schedules the processor. Filer ≠ approver is re-enforced
    // there and throws, rolling the decision back with it — an approval the
    // policy forbids must not stand. REJECTING one settles the receipt
    // terminally (`cancelled`) in the same transaction — a rejected request
    // must never wedge the subject behind the live-unique index.
    if (approval.resourceType === 'erasure') {
      if (args.status === 'executing') {
        await confirmAndScheduleErasure(tx, {
          requestId: approval.resourceId,
          approverId: args.actor.userId,
          organizationId: args.organizationId,
        });
      } else {
        await rejectErasure(tx, {
          requestId: approval.resourceId,
          rejectedBy: args.actor.userId,
          organizationId: args.organizationId,
          ...(args.comments !== undefined ? { comments: args.comments } : {}),
        });
      }
    }
    await emitHintInTx(tx, {
      orgId: args.organizationId,
      entity: 'approval',
      entityId: args.approvalId,
    });
    // A run still walking is not parked yet: it reads the decision when it
    // parks (`suspendRun`). A finished or deleted one is a silent no-op.
    if (wakes !== null) await pokeParkedRunInTx(tx, wakes);
  });
}
