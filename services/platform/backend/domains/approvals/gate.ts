import type { Sql, TransactionSql } from 'postgres';

import { resolveApprovalRequirement } from '../../core/approvals/policy.ts';
import { toJson } from '../../db/sql.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';

/**
 * The approvals gate for live effectful connector writes — the 0.5 twin of
 * `convex/approvals/gate.ts`, the REUSED pure policy (`approval_policy`
 * rules, else: platform-internal allows, outbound requires) over the
 * `app.approvals` table.
 *
 * Keyed to the OPERATION (`resourceKey` = the dispatcher's idempotency key,
 * or `<runId>:<nodeId>` for an automation node): re-entering for the same
 * operation returns the same decision; an approved (`executing`) record is
 * consumed to `completed` the first time the gate lets it through, and a
 * later durable re-entry still reads it as granted.
 */

export type ApprovalGateDecision =
  | { decision: 'allow'; approvalId?: string }
  | { decision: 'needs-approval'; approvalId: string }
  | { decision: 'rejected'; approvalId: string; reason?: string };

export interface EvaluateApprovalGateArgs {
  organizationId: string;
  source: 'connector' | 'automation';
  resourceKey: string;
  connector: string;
  action: string;
  effect: 'read' | 'write';
  requestedBy?: string;
  platformInternal?: boolean;
  input?: unknown;
  credentialRef?: string;
  threadId?: string;
  messageId?: string;
  runId?: string;
  nodeId?: string;
  nodeType?: string;
  automation?: string;
}

export async function evaluateApprovalGate(
  sql: Sql,
  args: EvaluateApprovalGateArgs,
): Promise<ApprovalGateDecision> {
  if (!args.organizationId) {
    throw new Error(
      '[approvals] an approval decision must name the organization it acts for',
    );
  }
  // A read changes nothing in the outside world.
  if (args.effect !== 'write') {
    return { decision: 'allow' };
  }

  return sql.begin(async (tx) => {
    const existing = await lockNewestRecord(tx, args);
    if (existing !== null) return answerFromRecord(tx, existing);

    // Nothing on file: the policy decides whether this operation needs a
    // human at all.
    const policy = await readGovernancePolicyForOrg(
      tx,
      args.organizationId,
      'approval_policy',
    );
    const requirement = resolveApprovalRequirement({
      connector: args.connector,
      action: args.action,
      platformInternal: args.platformInternal === true,
      policy,
    });
    if (requirement === 'allow') return { decision: 'allow' };

    // The insert IS the claim. FOR UPDATE over zero rows locks nothing, so
    // two evaluations for one operation can both read "nothing on file";
    // the partial unique index (0074: one pending row per connector
    // operation) turns the second insert into a no-op instead of a twin
    // card, and the loser answers with the winner's record below.
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.approvals (
        org_id, status, resource_type, resource_id, priority, thread_id,
        message_id, metadata, created_at_ms
      ) VALUES (
        ${args.organizationId}, 'pending', 'connector_operation',
        ${args.resourceKey}, 'medium', ${args.threadId ?? null},
        ${args.messageId ?? null},
        ${tx.json(
          toJson({
            source: args.source,
            connector: args.connector,
            action: args.action,
            operationType: 'write',
            requestedAt: Date.now(),
            ...(args.requestedBy !== undefined
              ? { requestedBy: args.requestedBy }
              : {}),
            ...(args.input !== undefined ? { parameters: args.input } : {}),
            ...(args.credentialRef !== undefined
              ? { credentialRef: args.credentialRef }
              : {}),
            ...(args.runId !== undefined ? { runId: args.runId } : {}),
            ...(args.nodeId !== undefined ? { nodeId: args.nodeId } : {}),
            ...(args.nodeType !== undefined ? { nodeType: args.nodeType } : {}),
            ...(args.automation !== undefined
              ? { automation: args.automation }
              : {}),
          }),
        )},
        ${Date.now()}
      )
      ON CONFLICT (org_id, resource_type, resource_id)
        WHERE resource_type = 'connector_operation' AND status = 'pending'
        DO NOTHING
      RETURNING id
    `;
    const approvalId = inserted[0]?.id;
    if (approvalId !== undefined) {
      return { decision: 'needs-approval', approvalId };
    }
    // Lost the race: the winner's row is committed by now (ON CONFLICT
    // waits for it), so re-read the operation and answer as a re-entry.
    const winner = await lockNewestRecord(tx, args);
    if (winner === null) throw new Error('approval insert failed');
    return answerFromRecord(tx, winner);
  });
}

interface ApprovalRecord {
  id: string;
  status: 'pending' | 'executing' | 'completed' | 'rejected';
  metadata: Record<string, unknown> | null;
}

/** The operation's newest record, row-locked for the transaction. */
async function lockNewestRecord(
  tx: TransactionSql,
  args: { organizationId: string; resourceKey: string },
): Promise<ApprovalRecord | null> {
  const rows = await tx<ApprovalRecord[]>`
    SELECT id, status, metadata FROM app.approvals
    WHERE resource_type = 'connector_operation'
      AND resource_id = ${args.resourceKey}
      AND org_id = ${args.organizationId}
    ORDER BY seq DESC
    LIMIT 1
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/** An operation already on file keeps its answer, whatever the policy says
 * now; an approved (`executing`) record is consumed the first time through. */
async function answerFromRecord(
  tx: TransactionSql,
  existing: ApprovalRecord,
): Promise<ApprovalGateDecision> {
  switch (existing.status) {
    case 'pending':
      return { decision: 'needs-approval', approvalId: existing.id };
    case 'executing': {
      await tx`
        UPDATE app.approvals
        SET status = 'completed', executed_at_ms = ${Date.now()}
        WHERE id = ${existing.id}
      `;
      return { decision: 'allow', approvalId: existing.id };
    }
    case 'completed':
      return { decision: 'allow', approvalId: existing.id };
    case 'rejected': {
      const comments = existing.metadata?.comments;
      return {
        decision: 'rejected',
        approvalId: existing.id,
        ...(typeof comments === 'string' ? { reason: comments } : {}),
      };
    }
    default: {
      const exhaustive: never = existing.status;
      throw new Error(
        `[approvals] unhandled approval status: ${String(exhaustive)}`,
      );
    }
  }
}
