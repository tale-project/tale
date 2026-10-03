import {
  taskAgentRepairReceiptSchema,
  taskAgentReviewInputSchema,
  taskAgentReviewReceiptSchema,
  type TaskAgentRepairFrom,
  type TaskAgentRepairReceipt,
  type TaskAgentReviewReceipt,
} from '@tale/shared/schemas/task-review';
import type { TransactionSql } from 'postgres';

import { taskCommentRefusal } from '../../core/tasks/helpers.ts';
import { toJson } from '../../db/sql.ts';
import { TaskError } from './errors.ts';
import {
  nativeReviewDecision,
  type ReviewDecisionRow,
} from './review-decision.ts';
import type { TaskRow } from './service.ts';

export type StaleRepairCause =
  | 'task_moved'
  | 'run_superseded'
  | 'review_changed'
  | 'assignee_changed'
  | 'source_unavailable'
  | 'intervening_decision';

export interface StaleRepair {
  outcome: 'stale_repair';
  taskId: string;
  agentId: string | null;
  staleBecause: StaleRepairCause;
}
export function staleRepair(
  taskId: string,
  staleBecause: StaleRepairCause,
  agentId: string | null = null,
): StaleRepair {
  return { outcome: 'stale_repair', taskId, agentId, staleBecause };
}

export interface RepairDecision {
  decision: TaskAgentReviewReceipt;
  feedback: string;
  dispatch: TaskAgentRepairReceipt | null;
}

/** The rejected approval owns the claim. A bad/missing receipt never means
 * that a previously admitted repair may be started again. */
export async function readRepairDecision(
  tx: TransactionSql,
  task: TaskRow,
  from: TaskAgentRepairFrom,
  lock = false,
): Promise<RepairDecision | StaleRepair> {
  const rows = await tx<ReviewDecisionRow[]>`
    SELECT id, status, wf_execution_id AS "wfExecutionId", metadata
    FROM app.approvals
    WHERE id = ${from.approvalId} AND org_id = ${task.organizationId}
      AND resource_type = 'task_review' AND resource_id = ${task.id}
    ${lock ? tx`FOR UPDATE` : tx``}
  `;
  const row = rows[0];
  const decision = row === undefined ? null : nativeReviewDecision(row, task);
  if (
    row === undefined ||
    decision === null ||
    decision.runId !== from.runId ||
    decision.decision !== 'request_changes'
  ) {
    return staleRepair(task.id, 'review_changed');
  }
  const request = taskAgentReviewInputSchema.safeParse(
    row.metadata?.agentReviewRequest,
  );
  if (!request.success) return staleRepair(task.id, 'review_changed');
  let dispatch: TaskAgentRepairReceipt | null = null;
  if (row.metadata?.repairDispatch !== undefined) {
    const parsed = taskAgentRepairReceiptSchema.safeParse(
      row.metadata.repairDispatch,
    );
    if (
      !parsed.success ||
      parsed.data.taskId !== task.id ||
      parsed.data.approvalId !== decision.approvalId ||
      parsed.data.sourceRunId !== decision.runId ||
      parsed.data.feedbackCommentId !== decision.feedbackCommentId ||
      parsed.data.runId === decision.runId
    ) {
      return staleRepair(task.id, 'review_changed');
    }
    dispatch = parsed.data;
  }
  return { decision, feedback: request.data.feedback, dispatch };
}

export interface RepairReplay {
  outcome: 'started';
  runId: string;
  taskId: string;
  agentId: string;
  replayed: true;
  repairReceipt: TaskAgentRepairReceipt;
}

/** Authority was freshly checked by delegated admission. A later live run
 * of the SAME manager may recover history, never create another effect. */
export async function replayRepair(
  tx: TransactionSql,
  task: TaskRow,
  record: RepairDecision,
  managerAgentId: string,
  requestedAgentId?: string,
): Promise<RepairReplay | StaleRepair | null> {
  const receipt = record.dispatch;
  if (receipt === null) return null;
  if (receipt.managerAgentId !== managerAgentId) {
    throw new TaskError(
      'AGENT_START_FORBIDDEN',
      'Only the manager agent that admitted this repair may recover its admission receipt',
      403,
    );
  }
  if (
    requestedAgentId !== undefined &&
    requestedAgentId !== receipt.implementationAgentId
  ) {
    return staleRepair(
      task.id,
      'assignee_changed',
      receipt.implementationAgentId,
    );
  }
  const runs = await tx<{ id: string }[]>`
    SELECT id FROM app.project_agent_runs
    WHERE id = ${receipt.runId} AND org_id = ${task.organizationId}
      AND project_id = ${task.projectId} AND task_id = ${task.id}
      AND agent_id = ${receipt.implementationAgentId}
      AND trigger = 'delegated' AND started_via = 'agent'
      AND started_via_agent_id = ${receipt.managerAgentId}
      AND started_via_run_id = ${receipt.issuerRunId} AND in_place = false
      AND EXISTS (SELECT 1 FROM app.project_agent_runs source
        WHERE source.id = ${receipt.sourceRunId} AND source.org_id = ${task.organizationId}
          AND source.project_id = ${task.projectId} AND source.task_id = ${task.id}
          AND source.agent_id = ${receipt.implementationAgentId})
  `;
  if (runs.length !== 1) return staleRepair(task.id, 'source_unavailable');
  return {
    outcome: 'started',
    runId: receipt.runId,
    taskId: task.id,
    agentId: receipt.implementationAgentId,
    replayed: true,
    repairReceipt: receipt,
  };
}

/** Called with agent then task locked; the approval lock follows them.
 * Return-to-old-value human changes remain visible in the monotonic timeline. */
export async function prepareRepair(
  tx: TransactionSql,
  task: TaskRow,
  from: TaskAgentRepairFrom,
  agentId: string,
  managerAgentId: string,
): Promise<RepairDecision | RepairReplay | StaleRepair> {
  const record = await readRepairDecision(tx, task, from, true);
  if ('outcome' in record) return record;
  const replay = await replayRepair(tx, task, record, managerAgentId, agentId);
  if (replay !== null) return replay;
  if (task.archivedAt !== null || task.status !== 'todo')
    return staleRepair(task.id, 'task_moved', agentId);
  if (task.assigneeType !== 'agent' || task.assigneeId !== agentId)
    return staleRepair(task.id, 'assignee_changed', agentId);
  const latestReview = await tx<{ id: string }[]>`
    SELECT id FROM app.approvals
    WHERE org_id = ${task.organizationId} AND resource_type = 'task_review'
      AND resource_id = ${task.id}
    ORDER BY seq DESC LIMIT 1
  `;
  const pending = await tx<{ id: string }[]>`
    SELECT id FROM app.approvals
    WHERE org_id = ${task.organizationId} AND resource_type = 'task_review'
      AND resource_id = ${task.id} AND status = 'pending' LIMIT 1
  `;
  if (latestReview[0]?.id !== from.approvalId || pending.length > 0)
    return staleRepair(task.id, 'review_changed', agentId);
  const source = await tx<
    {
      id: string;
      agentId: string;
      status: string;
      settledAt: number | null;
      inPlace: boolean;
    }[]
  >`
    SELECT id, agent_id AS "agentId", status, settled_at_ms::float8 AS "settledAt", in_place AS "inPlace"
    FROM app.project_agent_runs
    WHERE org_id = ${task.organizationId} AND project_id = ${task.projectId} AND task_id = ${task.id}
    ORDER BY seq DESC LIMIT 1
  `;
  if (source[0]?.id !== from.runId)
    return staleRepair(task.id, 'run_superseded', agentId);
  if (
    source[0].agentId !== agentId ||
    source[0].status !== 'settled' ||
    source[0].settledAt === null ||
    source[0].inPlace
  ) {
    return staleRepair(task.id, 'source_unavailable', agentId);
  }
  const events = await tx<
    {
      action: string;
      actorType: string;
      actorId: string;
      toValue: string | null;
    }[]
  >`
    SELECT action, actor_type AS "actorType", actor_id AS "actorId", to_value AS "toValue"
    FROM app.task_activity
    WHERE org_id = ${task.organizationId} AND project_id = ${task.projectId} AND task_id = ${task.id}
      AND action IN ('status.changed', 'assignee.changed', 'archived', 'restored', 'review.responded')
    ORDER BY id DESC LIMIT 1
  `;
  const event = events[0];
  let eventReceipt: TaskAgentReviewReceipt | null = null;
  if (
    event?.action === 'review.responded' &&
    event.actorType === 'agent' &&
    event.actorId === record.decision.reviewer.agentId &&
    event.toValue !== null
  ) {
    try {
      const parsed = taskAgentReviewReceiptSchema.safeParse(
        JSON.parse(event.toValue),
      );
      if (parsed.success) eventReceipt = parsed.data;
    } catch {
      /* An unreadable event is not a decision. */
    }
  }
  if (JSON.stringify(eventReceipt) !== JSON.stringify(record.decision))
    return staleRepair(task.id, 'intervening_decision', agentId);
  return record;
}

export function repairFeedback(
  record: RepairDecision,
  additional?: string,
): string {
  const r = record.decision;
  const result =
    `repair R=${r.runId} P=${r.approvalId} F=${r.feedbackCommentId}\n\n${record.feedback}` +
    (additional === undefined || additional.trim() === ''
      ? ''
      : `\n\n${additional}`);
  const refusal = taskCommentRefusal(result);
  if (refusal !== null) throw new TaskError('TASK_COMMENT_INVALID', refusal);
  return result;
}

export async function recordRepairAdmission(
  tx: TransactionSql,
  task: TaskRow,
  record: RepairDecision,
  args: {
    runId: string;
    implementationAgentId: string;
    managerAgentId: string;
    issuerRunId: string;
  },
): Promise<TaskAgentRepairReceipt> {
  const receipt: TaskAgentRepairReceipt = {
    taskId: task.id,
    approvalId: record.decision.approvalId,
    sourceRunId: record.decision.runId,
    feedbackCommentId: record.decision.feedbackCommentId,
    ...args,
    admittedAt: Date.now(),
  };
  const result = await tx`
    UPDATE app.approvals SET metadata = coalesce(metadata, '{}'::jsonb) || ${tx.json(toJson({ repairDispatch: receipt }))}
    WHERE id = ${receipt.approvalId} AND org_id = ${task.organizationId}
      AND resource_type = 'task_review' AND resource_id = ${task.id}
      AND status = 'rejected' AND wf_execution_id IS NULL AND NOT (metadata ? 'repairDispatch')
  `;
  if (result.count !== 1)
    throw new TaskError(
      'TASK_REPAIR_STALE',
      'The repair admission changed; read the task again',
      409,
    );
  return receipt;
}
