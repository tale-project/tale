import type { TransactionSql } from 'postgres';

import { recordActivity } from './service.ts';

/**
 * Clear every task assignment that names one project agent — the tasks side
 * of deleting the agent, run inside the delete's own transaction so the
 * board never shows a card "assigned" to a row that no longer exists.
 *
 * Each task keeps its history: the row's runs, comments and activity stay,
 * and one more `assignee.changed` line (from the agent, to nobody) says why
 * the card is unassigned. `recordActivity` also hints the task, so open
 * boards drop the stale name at once.
 *
 * Answers the ids it cleared, so the caller can audit or count them.
 */
export async function clearAgentAssignmentsInTx(
  tx: TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    agentId: string;
    /** The person deleting the agent — the activity's actor. */
    actorId: string;
  },
): Promise<string[]> {
  const cleared = await tx<{ id: string }[]>`
    UPDATE app.tasks SET
      assignee_type = NULL,
      assignee_id = NULL,
      updated_at_ms = ${Date.now()}
    WHERE org_id = ${args.organizationId}
      AND project_id = ${args.projectId}
      AND assignee_type = 'agent'
      AND assignee_id = ${args.agentId}
    RETURNING id
  `;
  for (const row of cleared) {
    await recordActivity(tx, {
      task: {
        id: row.id,
        organizationId: args.organizationId,
        projectId: args.projectId,
      },
      actorType: 'user',
      actorId: args.actorId,
      action: 'assignee.changed',
      fromValue: args.agentId,
    });
  }
  return cleared.map((row) => row.id);
}
