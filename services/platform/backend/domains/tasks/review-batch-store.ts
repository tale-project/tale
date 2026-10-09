import {
  taskReviewBatchTargetsSchema,
  type TaskReviewBatchStart,
  type TaskReviewBatchResult,
  type TaskReviewBatchTarget,
} from '@tale/shared/schemas/task-review-batch';
import type { TransactionSql } from 'postgres';

import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import { TaskError } from './errors.ts';
import {
  reviewBatchResult,
  type ReviewBatchDecisionRow,
} from './review-batch-result.ts';

export interface ReviewBatchRow {
  id: string;
  organizationId: string;
  projectId: string;
  contextTaskId: string;
  reviewerAgentId: string;
  managerAgentId: string;
  issuerRunId: string;
  requestId: string;
  targets: unknown;
  envelopeHash: string;
}

/** Includes one overflow witness. This is a read bound, not a new retry
 * budget; the existing retry policy remains the only admission authority. */
export const REVIEW_BATCH_RUN_READ_LIMIT = 128;

export async function readReviewBatch(
  tx: TransactionSql,
  organizationId: string,
  projectId: string,
  batchId: string,
): Promise<ReviewBatchRow> {
  const rows = await tx<ReviewBatchRow[]>`
    SELECT id, org_id AS "organizationId", project_id AS "projectId",
      context_task_id AS "contextTaskId", reviewer_agent_id AS "reviewerAgentId",
      manager_agent_id AS "managerAgentId", issuer_run_id AS "issuerRunId",
      request_id AS "requestId", targets, envelope_hash AS "envelopeHash"
    FROM app.task_review_batches
    WHERE id = ${batchId} AND org_id = ${organizationId} AND project_id = ${projectId}
  `;
  const row = rows[0];
  if (row === undefined)
    throw new TaskError('TASK_NOT_FOUND', 'Review batch not found', 404);
  return row;
}

export function reviewBatchTargets(
  batch: ReviewBatchRow,
): TaskReviewBatchTarget[] {
  const targets = taskReviewBatchTargetsSchema.safeParse(batch.targets);
  if (
    !targets.success ||
    managedConfigurationHash(targets.data) !== batch.envelopeHash
  )
    throw new TaskError(
      'TASK_REVIEW_STALE',
      'The stored review envelope is unavailable',
      409,
    );
  return targets.data;
}

export async function projectReviewBatch(
  tx: TransactionSql,
  batch: ReviewBatchRow,
): Promise<TaskReviewBatchResult> {
  const targets = reviewBatchTargets(batch);
  const runs = await tx<{ runId: string; status: string }[]>`
    SELECT id AS "runId", status FROM app.project_agent_runs
    WHERE org_id = ${batch.organizationId} AND project_id = ${batch.projectId}
      AND task_id = ${batch.contextTaskId} AND agent_id = ${batch.reviewerAgentId}
      AND review_batch_id = ${batch.id} AND in_place = true
      AND started_via = 'agent' AND started_via_agent_id = ${batch.managerAgentId}
      AND started_via_run_id = ${batch.issuerRunId}
    ORDER BY seq LIMIT ${REVIEW_BATCH_RUN_READ_LIMIT + 1}
  `;
  if (runs.length > REVIEW_BATCH_RUN_READ_LIMIT)
    throw new TaskError(
      'TASK_REVIEW_STALE',
      'Review batch attempt history exceeds its read bound; no complete result is asserted',
      409,
    );
  const approvals = await tx<ReviewBatchDecisionRow[]>`
    SELECT id, resource_id AS "taskId", status, metadata FROM app.approvals
    WHERE org_id = ${batch.organizationId} AND resource_type = 'task_review'
      AND wf_execution_id IS NULL
      AND id = ANY(${targets.map((target) => target.expected.approvalId)})
  `;
  return reviewBatchResult({
    batchId: batch.id,
    projectId: batch.projectId,
    contextTaskId: batch.contextTaskId,
    reviewerAgentId: batch.reviewerAgentId,
    requestId: batch.requestId,
    targets,
    runs,
    approvals,
  });
}

export async function replayReviewBatch(
  tx: TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    managerAgentId: string;
    request: TaskReviewBatchStart;
  },
): Promise<ReviewBatchRow | null> {
  const rows = await tx<{ id: string; envelopeHash: string }[]>`
    SELECT id, envelope_hash AS "envelopeHash" FROM app.task_review_batches
    WHERE org_id = ${args.organizationId} AND project_id = ${args.projectId}
      AND context_task_id = ${args.request.contextTaskId}
      AND manager_agent_id = ${args.managerAgentId} AND request_id = ${args.request.requestId}
  `;
  const prior = rows[0];
  if (prior === undefined) return null;
  if (prior.envelopeHash !== managedConfigurationHash(args.request.targets))
    throw new TaskError(
      'TASK_REVIEW_STALE',
      'The request ID already names a different fixed review envelope',
      409,
    );
  return readReviewBatch(tx, args.organizationId, args.projectId, prior.id);
}

/** Durable feedback on every attempt, including retries. Decisions already
 * attested to this batch remain visible through read_batch and are not replayed. */
export function reviewBatchFeedback(batch: ReviewBatchRow): string {
  return `Review batch ${batch.id}. Use task_review operation read_batch with batchId ${batch.id} to reconcile native decisions first. Review only unresolved declared targets through the existing native review tools. A report or a settled run is not a decision. Do not create another review-report task. Fixed targets: ${JSON.stringify(reviewBatchTargets(batch))}`;
}
