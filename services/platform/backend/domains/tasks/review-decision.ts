import {
  taskAgentReviewInputSchema,
  taskAgentReviewReceiptSchema,
  taskReviewRecipientSchema,
  type TaskAgentReviewReceipt,
} from '@tale/shared/schemas/task-review';
import type { Sql, TransactionSql } from 'postgres';

export interface ReviewDecisionRow {
  id: string;
  status: string;
  wfExecutionId: string | null;
  metadata: Record<string, unknown> | null;
}

/** One native decision, validated against its immutable request and ledger row.
 * No historical receipt implies that the task still has that state. */
export function nativeReviewDecision(
  row: ReviewDecisionRow,
  task: { id: string; projectId: string },
): TaskAgentReviewReceipt | null {
  const receipt = taskAgentReviewReceiptSchema.safeParse(
    row.metadata?.response,
  );
  const request = taskAgentReviewInputSchema.safeParse(
    row.metadata?.agentReviewRequest,
  );
  if (!receipt.success || !request.success || row.wfExecutionId !== null)
    return null;
  const decision = receipt.data;
  const reviewer = taskReviewRecipientSchema.safeParse(row.metadata?.reviewer);
  if (
    !reviewer.success ||
    reviewer.data.kind !== 'agent' ||
    reviewer.data.agentId !== decision.reviewer.agentId ||
    decision.status !== (decision.decision === 'approve' ? 'done' : 'todo') ||
    row.id !== decision.approvalId ||
    decision.taskId !== task.id ||
    row.metadata?.projectId !== task.projectId ||
    row.metadata.runId !== decision.runId ||
    row.status !==
      (decision.decision === 'approve' ? 'completed' : 'rejected') ||
    request.data.taskId !== task.id ||
    request.data.decision !== decision.decision ||
    request.data.expected.approvalId !== row.id ||
    request.data.expected.runId !== decision.runId ||
    request.data.expected.evidenceRevision !== decision.evidenceRevision ||
    JSON.stringify(request.data.evidence) !== JSON.stringify(decision.evidence)
  )
    return null;
  return decision;
}

/** Never reach behind a newer pending, human, workflow or malformed review. */
export async function readTaskReviewDecision(
  sql: Sql | TransactionSql,
  args: { organizationId: string; projectId: string; taskId: string },
): Promise<TaskAgentReviewReceipt | null> {
  const rows = await sql<ReviewDecisionRow[]>`
    SELECT a.id, a.status, a.wf_execution_id AS "wfExecutionId", a.metadata
    FROM app.approvals a
    JOIN app.tasks t ON t.id = a.resource_id AND t.org_id = a.org_id
    WHERE a.org_id = ${args.organizationId} AND a.resource_type = 'task_review'
      AND a.resource_id = ${args.taskId} AND t.project_id = ${args.projectId}
    ORDER BY a.seq DESC LIMIT 1
  `;
  return rows[0] === undefined
    ? null
    : nativeReviewDecision(rows[0], {
        id: args.taskId,
        projectId: args.projectId,
      });
}
