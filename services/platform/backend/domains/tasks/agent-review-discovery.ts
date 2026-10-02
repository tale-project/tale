import type { PendingReviewIdentity } from '@tale/shared/schemas/task-review';
import type { Sql } from 'postgres';

import { taskReviewRecipientOf } from './reviews.ts';

/** Captured review identities for one already-authorized task_find page.
 * The caller's task page is bounded; this single read does not fetch policy,
 * agents or source evidence per task. task_get owns that detailed diagnosis. */
export async function readAgentTaskReviewSummaries(
  sql: Sql,
  organizationId: string,
  taskIds: readonly string[],
): Promise<Map<string, PendingReviewIdentity>> {
  if (taskIds.length === 0) return new Map();
  const rows = await sql<
    {
      taskId: string;
      approvalId: string;
      metadata: Record<string, unknown> | null;
    }[]
  >`
    SELECT DISTINCT ON (a.resource_id)
      a.resource_id AS "taskId", a.id AS "approvalId", a.metadata
    FROM app.approvals a
    JOIN app.tasks t ON t.id = a.resource_id AND t.org_id = a.org_id
    WHERE a.org_id = ${organizationId} AND a.resource_id = ANY(${taskIds})
      AND a.resource_type = 'task_review' AND a.status = 'pending'
      AND a.wf_execution_id IS NULL
    ORDER BY a.resource_id, a.seq DESC
  `;
  return new Map(
    rows.map((row) => [
      row.taskId,
      {
        approvalId: row.approvalId,
        runId:
          typeof row.metadata?.runId === 'string' ? row.metadata.runId : null,
        reviewer: taskReviewRecipientOf(row.metadata),
      },
    ]),
  );
}
