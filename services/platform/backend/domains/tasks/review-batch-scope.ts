import {
  taskReviewBatchTargetsSchema,
  type TaskReviewBatchTarget,
} from '@tale/shared/schemas/task-review-batch';
import type { TransactionSql } from 'postgres';

import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import type { AgentReviewAuthority } from './agent-review.ts';
import { TaskError } from './errors.ts';

/** Ordinary reviewer runs keep their existing scope. A batch-bound run can
 * stage/decide only the exact declared targets, never substitute another task
 * or newer evidence after its manager's fixed declaration. */
export async function assertReviewBatchTarget(
  tx: TransactionSql,
  auth: AgentReviewAuthority,
  issuerRunId: string,
  target: TaskReviewBatchTarget,
): Promise<void> {
  const rows = await tx<
    {
      batchId: string | null;
      targets: unknown;
      envelopeHash: string | null;
    }[]
  >`
    SELECT r.review_batch_id AS "batchId", b.targets, b.envelope_hash AS "envelopeHash"
    FROM app.project_agent_runs r
    LEFT JOIN app.task_review_batches b ON b.id = r.review_batch_id
      AND b.org_id = r.org_id AND b.project_id = r.project_id
      AND b.context_task_id = r.task_id AND b.reviewer_agent_id = r.agent_id
      AND r.in_place = true AND r.started_via = 'agent'
      AND r.started_via_agent_id = b.manager_agent_id AND r.started_via_run_id = b.issuer_run_id
    WHERE r.id = ${issuerRunId} AND r.org_id = ${auth.organizationId}
      AND r.project_id = ${auth.projectId} AND r.agent_id = ${auth.agentId}
  `;
  const row = rows[0];
  if (row?.batchId === null) return;
  const targets = taskReviewBatchTargetsSchema.safeParse(row?.targets);
  if (
    !targets.success ||
    managedConfigurationHash(targets.data) !== row?.envelopeHash ||
    !targets.data.some(
      (declared) =>
        declared.taskId === target.taskId &&
        declared.expected.approvalId === target.expected.approvalId &&
        declared.expected.runId === target.expected.runId &&
        declared.expected.evidenceRevision === target.expected.evidenceRevision,
    )
  )
    throw new TaskError(
      'TASK_REVIEW_FORBIDDEN',
      'This review occurrence may inspect and decide only its exact declared targets',
      403,
    );
}
