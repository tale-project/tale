import type { TransactionSql } from 'postgres';

import { assertNotHeld, loadActiveHolds } from '../legal_holds/service.ts';

/** The shared retirement walk calls this before cancelling runs or deleting
 * files. Ordinary tasks keep their existing policy. New operational evidence
 * follows the maintained org/custodian predicate: the context's user author
 * and its runs' bare started_by identities (also used by run retention).
 * No orphan FK rows or unrelated source-task deletions are introduced. */
export async function assertReviewContextsRetirable(
  tx: TransactionSql,
  args: { organizationId: string; projectId: string; taskIds: string[] },
): Promise<void> {
  const contexts = await tx<{ taskId: string; authorUserId: string | null }[]>`
    SELECT c.task_id AS "taskId",
      CASE WHEN t.created_by_type = 'user' THEN t.created_by ELSE NULL END AS "authorUserId"
    FROM app.task_review_contexts c
    JOIN app.tasks t ON t.id = c.task_id AND t.org_id = c.org_id
    WHERE c.org_id = ${args.organizationId} AND c.project_id = ${args.projectId}
      AND c.task_id = ANY(${args.taskIds})
  `;
  if (contexts.length === 0) return;
  const holds = await loadActiveHolds(tx, args.organizationId);
  for (const context of contexts)
    await assertNotHeld(
      tx,
      args.organizationId,
      'task',
      context.taskId,
      holds,
      context.authorUserId ?? undefined,
    );
  if (holds.userMembershipIds.size === 0) return;
  const held = await tx<{ taskId: string; startedBy: string }[]>`
    SELECT r.task_id AS "taskId", r.started_by AS "startedBy"
    FROM app.project_agent_runs r
    JOIN app.task_review_contexts c ON c.task_id = r.task_id AND c.org_id = r.org_id
    WHERE c.org_id = ${args.organizationId} AND c.project_id = ${args.projectId}
      AND c.task_id = ANY(${args.taskIds}) AND r.started_by = ANY(${[...holds.userMembershipIds]})
    LIMIT 1
  `;
  if (held[0] !== undefined)
    await assertNotHeld(
      tx,
      args.organizationId,
      'task',
      held[0].taskId,
      holds,
      held[0].startedBy,
    );
}
