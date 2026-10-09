import { randomUUID } from 'node:crypto';

import type { TaskReviewBatchStart } from '@tale/shared/schemas/task-review-batch';
import type { TransactionSql } from 'postgres';

import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import { toJson } from '../../db/sql.ts';
import { readPendingAgentReviewTarget } from './agent-review.ts';
import { TaskError } from './errors.ts';
import { readReviewBatch, type ReviewBatchRow } from './review-batch-store.ts';
import { readReviewContext } from './review-context.ts';
import { agentReviewerEligibility } from './reviews.ts';

/** Called only after delegated start owns agent→task locks, checked live
 * occupancy and admitted its existing circuit breaker. No target is locked or
 * changed. The actual decision repeats its native CAS if a target changes. */
export async function admitReviewBatch(
  tx: TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    reviewerAgentId: string;
    managerAgentId: string;
    issuerRunId: string;
    request: TaskReviewBatchStart;
  },
): Promise<ReviewBatchRow> {
  const context = await readReviewContext(
    tx,
    args.organizationId,
    args.request.contextTaskId,
  );
  if (
    context?.projectId !== args.projectId ||
    !context.enabled ||
    context.reviewerAgentId !== args.reviewerAgentId
  )
    throw new TaskError(
      'TASK_REVIEW_FORBIDDEN',
      'Use an enabled managed review context with its enrolled reviewer',
      403,
    );
  if (
    (await agentReviewerEligibility(tx, {
      organizationId: args.organizationId,
      projectId: args.projectId,
      agentId: args.reviewerAgentId,
    })) !== 'eligible'
  )
    throw new TaskError(
      'TASK_REVIEW_FORBIDDEN',
      'The enrolled reviewer is unavailable or lost task_review',
      403,
    );
  for (const target of args.request.targets) {
    if (target.taskId === args.request.contextTaskId)
      throw new TaskError(
        'TASK_REVIEW_INVALID',
        'A review context cannot review itself',
      );
    await readPendingAgentReviewTarget(
      tx,
      {
        organizationId: args.organizationId,
        projectId: args.projectId,
        agentId: args.reviewerAgentId,
      },
      target,
    );
  }
  const id = randomUUID();
  const envelopeHash = managedConfigurationHash(args.request.targets);
  await tx`
    INSERT INTO app.task_review_batches
      (id, org_id, project_id, context_task_id, reviewer_agent_id, manager_agent_id,
       issuer_run_id, request_id, targets, envelope_hash, created_at_ms)
    VALUES (${id}, ${args.organizationId}, ${args.projectId}, ${args.request.contextTaskId},
      ${args.reviewerAgentId}, ${args.managerAgentId}, ${args.issuerRunId},
      ${args.request.requestId}, ${tx.json(toJson(args.request.targets))}, ${envelopeHash}, ${Date.now()})
  `;
  return readReviewBatch(tx, args.organizationId, args.projectId, id);
}
