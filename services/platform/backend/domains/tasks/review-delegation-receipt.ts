import {
  taskDelegateReviewInputSchema,
  taskDelegateReviewReceiptSchema,
  type TaskDelegateReviewReceipt,
} from '@tale/shared/schemas/task-review';
import type { Sql, TransactionSql } from 'postgres';

import { taskReviewRecipientOf, type ApprovalRow } from './reviews.ts';

/** A historical handoff is valid only when its predecessor, strict request and
 * immutable receipt agree. It never describes current ownership or execution. */
export function nativeReviewDelegation(
  row: Pick<ApprovalRow, 'id' | 'status' | 'wfExecutionId' | 'metadata'>,
  task: { id: string; projectId: string },
): TaskDelegateReviewReceipt | null {
  const parsed = taskDelegateReviewReceiptSchema.safeParse(
    row.metadata?.delegation,
  );
  const requested = taskDelegateReviewInputSchema.safeParse(
    row.metadata?.delegationRequest,
  );
  if (!parsed.success || !requested.success) return null;
  const receipt = parsed.data;
  const request = requested.data;
  const reviewer = taskReviewRecipientOf(row.metadata);
  if (
    row.status !== 'rejected' ||
    row.wfExecutionId !== null ||
    row.id !== receipt.previousApprovalId ||
    row.id !== request.expected.approvalId ||
    row.metadata?.supersededBy !== receipt.approvalId ||
    row.metadata.projectId !== task.projectId ||
    row.metadata.runId !== receipt.runId ||
    task.id !== receipt.taskId ||
    task.id !== request.taskId ||
    request.expected.runId !== receipt.runId ||
    request.expected.evidenceRevision !== receipt.evidenceRevision ||
    reviewer?.kind !== 'agent' ||
    reviewer.agentId !== receipt.previousReviewer.agentId ||
    reviewer.agentId !== request.expected.reviewer.agentId ||
    request.reviewerAgentId !== receipt.reviewer.agentId ||
    request.reason !== receipt.reason ||
    receipt.approvalId === row.id ||
    receipt.reviewer.agentId === reviewer.agentId ||
    receipt.reviewer.agentId === receipt.managerAgentId
  )
    return null;
  return receipt;
}

/** Bounded history: the predecessor of the latest gate only. A newer handoff,
 * submission or malformed record hides older receipts rather than implying
 * that their recipient still owns the review. */
export async function readTaskReviewDelegation(
  sql: Sql | TransactionSql,
  args: { organizationId: string; projectId: string; taskId: string },
): Promise<TaskDelegateReviewReceipt | null> {
  const rows = await sql<ApprovalRow[]>`
    SELECT a.id, a.status, a.wf_execution_id AS "wfExecutionId", a.metadata
    FROM app.approvals a
    JOIN app.tasks t ON t.id = a.resource_id AND t.org_id = a.org_id
    WHERE a.org_id = ${args.organizationId} AND a.resource_type = 'task_review'
      AND a.resource_id = ${args.taskId} AND t.project_id = ${args.projectId}
    ORDER BY a.seq DESC LIMIT 2
  `;
  const latest = rows[0];
  const previous = rows[1];
  if (
    latest === undefined ||
    previous === undefined ||
    latest.wfExecutionId !== null
  )
    return null;
  const receipt = nativeReviewDelegation(previous, {
    id: args.taskId,
    projectId: args.projectId,
  });
  const reviewer = taskReviewRecipientOf(latest.metadata);
  return receipt !== null &&
    receipt.approvalId === latest.id &&
    latest.metadata?.runId === receipt.runId &&
    latest.metadata.projectId === args.projectId &&
    reviewer?.kind === 'agent' &&
    reviewer.agentId === receipt.reviewer.agentId
    ? receipt
    : null;
}
