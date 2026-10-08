import {
  taskDelegateReviewInputSchema,
  taskDelegateReviewReceiptSchema,
  type TaskDelegateReviewReceipt,
} from '@tale/shared/schemas/task-review';
import type { TransactionSql } from 'postgres';

import { toJson } from '../../db/sql.ts';
import { loadProjectOrThrow } from '../projects/service.ts';
import { liveReviewIssuer, type AgentReviewAuthority } from './agent-review.ts';
import { queuedOnTask } from './comments.ts';
import { TaskError } from './errors.ts';
import { nativeReviewDelegation } from './review-delegation-receipt.ts';
import { readTaskReviewSource } from './review-evidence.ts';
import {
  agentReviewBlockedReason,
  handoffPendingTaskReview,
  taskReviewRecipientOf,
  type ApprovalRow,
} from './reviews.ts';
import { lockTaskRunStart } from './run-start.ts';
import {
  assertTaskCreatable,
  assertTaskNotArchived,
  loadTaskOrThrow,
  recordActivity,
  taskHasLiveRun,
} from './service.ts';

function stale(): never {
  throw new TaskError(
    'TASK_REVIEW_STALE',
    'The captured review or its evidence changed; read the task again before delegating',
    409,
  );
}

/** Serializable, source-bound routing. It changes the captured gate only;
 * task ownership, future reviewer defaults, evidence and execution stay intact. */
export async function delegateAgentTaskReview(
  tx: TransactionSql,
  auth: AgentReviewAuthority,
  raw: unknown,
): Promise<TaskDelegateReviewReceipt> {
  const parsed = taskDelegateReviewInputSchema.safeParse(raw);
  if (!parsed.success)
    throw new TaskError(
      'TASK_REVIEW_INVALID',
      'Invalid captured review delegation',
    );
  const input = parsed.data;
  const issuerRunId = await liveReviewIssuer(tx, auth, 'task_delegate_review');
  if (
    input.reviewerAgentId === auth.agentId ||
    input.reviewerAgentId === input.expected.reviewer.agentId
  ) {
    throw new TaskError(
      'TASK_REVIEW_FORBIDDEN',
      'Choose a different independent reviewer, not the delegating agent',
      403,
    );
  }
  const initial = await loadTaskOrThrow(tx, input.taskId, auth.organizationId);
  if (initial.projectId !== auth.projectId)
    throw new TaskError(
      'TASK_REVIEW_FORBIDDEN',
      'The task is outside this project',
      403,
    );
  return queuedOnTask(tx, input.taskId, async () => {
    await lockTaskRunStart(tx, auth.organizationId, input.taskId);
    const task = await loadTaskOrThrow(tx, input.taskId, auth.organizationId);
    if (task.projectId !== auth.projectId || task.status !== 'in_review')
      return stale();
    assertTaskNotArchived(task);
    const project = await loadProjectOrThrow(tx, task.projectId);
    assertTaskCreatable(project, {
      organizationId: auth.organizationId,
      userId: auth.agentId,
      role: 'admin',
      teamIds: [],
    });
    if (await taskHasLiveRun(tx, task))
      throw new TaskError(
        'TASK_REVIEW_BUSY',
        'A live run or question still holds this task',
        409,
      );
    const rows = await tx<ApprovalRow[]>`
      SELECT id, org_id AS "organizationId", status, wf_execution_id AS "wfExecutionId", metadata
      FROM app.approvals WHERE id = ${input.expected.approvalId}
        AND org_id = ${auth.organizationId} AND resource_type = 'task_review'
        AND resource_id = ${input.taskId} FOR UPDATE
    `;
    const approval = rows[0];
    const captured = taskReviewRecipientOf(approval?.metadata ?? null);
    if (
      approval === undefined ||
      approval.wfExecutionId !== null ||
      captured?.kind !== 'agent' ||
      captured.agentId !== input.expected.reviewer.agentId ||
      approval.metadata?.runId !== input.expected.runId ||
      approval.metadata.projectId !== auth.projectId
    )
      return stale();
    const source = await readTaskReviewSource(tx, {
      organizationId: auth.organizationId,
      taskId: task.id,
      runId: input.expected.runId,
    });
    if (source?.implementationAgentId === auth.agentId)
      throw new TaskError(
        'TASK_REVIEWER_NOT_INDEPENDENT',
        'The implementation agent cannot delegate the review of its own work',
        403,
      );
    if (source?.evidenceRevision !== input.expected.evidenceRevision)
      return stale();
    const block = await agentReviewBlockedReason(tx, {
      organizationId: auth.organizationId,
      taskId: task.id,
      reviewerAgentId: input.reviewerAgentId,
      source,
    });
    if (block !== null)
      throw new TaskError(
        block === 'permission_missing'
          ? 'TASK_REVIEWER_PERMISSION_MISSING'
          : block === 'reviewer_unavailable'
            ? 'TASK_REVIEWER_INVALID'
            : block === 'self_review'
              ? 'TASK_REVIEWER_NOT_INDEPENDENT'
              : block === 'human_policy'
                ? 'TASK_REVIEWER_HUMAN_REQUIRED'
                : block === 'policy_unavailable'
                  ? 'GOVERNANCE_POLICY_UNAVAILABLE'
                  : 'TASK_REVIEW_SOURCE_CHANGED',
        'Restore the captured source, review permission and review policy before delegating',
        409,
      );
    if (approval.status !== 'pending') {
      const receipt = nativeReviewDelegation(approval, task);
      const previous = taskDelegateReviewInputSchema.safeParse(
        approval.metadata?.delegationRequest,
      );
      if (
        receipt === null ||
        !previous.success ||
        JSON.stringify(previous.data) !== JSON.stringify(input) ||
        receipt.managerAgentId !== auth.agentId ||
        receipt.issuerRunId !== issuerRunId
      )
        return stale();
      const pending = await tx<ApprovalRow[]>`
        SELECT id, metadata, wf_execution_id AS "wfExecutionId" FROM app.approvals
        WHERE org_id = ${auth.organizationId} AND resource_type = 'task_review'
          AND resource_id = ${task.id} AND status = 'pending'
      `;
      const successor = pending[0];
      const recipient = taskReviewRecipientOf(successor?.metadata ?? null);
      if (
        pending.length !== 1 ||
        successor?.id !== receipt.approvalId ||
        successor.wfExecutionId !== null ||
        successor.metadata?.runId !== receipt.runId ||
        successor.metadata.projectId !== auth.projectId ||
        recipient?.kind !== 'agent' ||
        recipient.agentId !== receipt.reviewer.agentId
      )
        return stale();
      return receipt;
    }
    const reviewer = { kind: 'agent' as const, agentId: input.reviewerAgentId };
    const approvalId = await handoffPendingTaskReview(tx, {
      task,
      expected: input.expected,
      reviewer,
      actor: { kind: 'agent', agentId: auth.agentId },
    });
    if (approvalId === null || approvalId === approval.id) return stale();
    const receipt = taskDelegateReviewReceiptSchema.parse({
      taskId: task.id,
      previousApprovalId: approval.id,
      approvalId,
      runId: input.expected.runId,
      evidenceRevision: input.expected.evidenceRevision,
      previousReviewer: input.expected.reviewer,
      reviewer,
      managerAgentId: auth.agentId,
      issuerRunId,
      reason: input.reason,
      delegatedAt: Date.now(),
    });
    await tx`
      UPDATE app.approvals SET metadata = coalesce(metadata, '{}'::jsonb)
        || ${tx.json(toJson({ delegation: receipt, delegationRequest: input }))}
      WHERE id = ${approval.id} AND org_id = ${auth.organizationId}
        AND status = 'rejected' AND wf_execution_id IS NULL
    `;
    await recordActivity(tx, {
      task,
      actorType: 'agent',
      actorId: auth.agentId,
      action: 'review.delegated',
      fromValue: JSON.stringify(receipt.previousReviewer),
      toValue: JSON.stringify(receipt.reviewer),
    });
    return receipt;
  });
}
