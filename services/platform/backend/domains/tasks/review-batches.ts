import {
  taskReviewBatchReadSchema,
  taskReviewBatchStartSchema,
} from '@tale/shared/schemas/task-review-batch';
import type { TransactionSql } from 'postgres';

import { liveReviewIssuer, type AgentReviewAuthority } from './agent-review.ts';
import { startDelegatedAgentRun } from './delegated-start.ts';
import { TaskError } from './errors.ts';
import { projectReviewBatch, readReviewBatch } from './review-batch-store.ts';
import { readReviewContext } from './review-context.ts';

/** The shim first authenticates an unconfined project-wide native run.
 * Delegated start owns current start grant/provenance, one-hop and admission;
 * this door adds current review grant and a managed fixed-target context. */
export async function startAgentReviewBatch(
  tx: TransactionSql,
  auth: AgentReviewAuthority,
  raw: unknown,
) {
  const parsed = taskReviewBatchStartSchema.safeParse(raw);
  if (!parsed.success)
    throw new TaskError(
      'TASK_REVIEW_INVALID',
      'Declare one managed context, a request UUID and 1–20 unique exact pending reviews',
    );
  const input = parsed.data;
  const issuerRunId = await liveReviewIssuer(tx, auth);
  const context = await readReviewContext(
    tx,
    auth.organizationId,
    input.contextTaskId,
  );
  if (context === null || context.projectId !== auth.projectId)
    throw new TaskError(
      'TASK_NOT_FOUND',
      'Managed review context not found',
      404,
    );
  const issuers = await tx<{ startedBy: string; apiKeyId: string | null }[]>`
    SELECT started_by AS "startedBy", api_key_id AS "apiKeyId" FROM app.project_agent_runs
    WHERE id = ${issuerRunId} AND org_id = ${auth.organizationId}
      AND project_id = ${auth.projectId} AND agent_id = ${auth.agentId}
  `;
  const issuer = issuers[0];
  if (issuer === undefined)
    throw new TaskError(
      'TASK_REVIEW_FORBIDDEN',
      'The live review manager is unavailable',
      403,
    );
  return startDelegatedAgentRun(tx, {
    organizationId: auth.organizationId,
    scopeProjectIds: [auth.projectId],
    taskId: input.contextTaskId,
    agentId: context.reviewerAgentId,
    startedBy: issuer.startedBy,
    ...(issuer.apiKeyId !== null ? { apiKeyId: issuer.apiKeyId } : {}),
    via: { kind: 'agent', runId: issuerRunId, agentId: auth.agentId },
    moveToInProgress: false,
    reviewBatch: input,
  });
}

/** Native recovery read. It never starts an occurrence, clears a source gate,
 * or promotes incomplete results when an attempt has settled. */
export async function readAgentReviewBatch(
  tx: TransactionSql,
  auth: AgentReviewAuthority,
  raw: unknown,
) {
  const parsed = taskReviewBatchReadSchema.safeParse(raw);
  if (!parsed.success)
    throw new TaskError(
      'TASK_REVIEW_INVALID',
      'Name the exact review batch UUID',
    );
  await liveReviewIssuer(tx, auth);
  const batch = await readReviewBatch(
    tx,
    auth.organizationId,
    auth.projectId,
    parsed.data.batchId,
  );
  if (
    auth.agentId !== batch.managerAgentId &&
    auth.agentId !== batch.reviewerAgentId
  )
    throw new TaskError(
      'TASK_REVIEW_FORBIDDEN',
      'Only this batch manager or reviewer may read its native decision envelope',
      403,
    );
  return projectReviewBatch(tx, batch);
}
