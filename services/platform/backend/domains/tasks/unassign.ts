import type { TransactionSql } from 'postgres';

import { emitHintInTx } from '../../realtime/outbox.ts';
import { endRepeatForAutomationOwner } from './repeat.ts';
import { recordActivity } from './service.ts';

/**
 * Clear every task assignment that names one project agent — the tasks side
 * of deleting the agent, run inside the delete's own transaction so the
 * board never shows a card "assigned" to a row that no longer exists. That
 * is every board: an agent of a project whose dispatch serves other boards
 * (`dispatch-reach.ts`) holds tasks there too.
 *
 * Each task keeps its history: the row's runs, comments and activity stay,
 * and one more `assignee.changed` line (from the agent, to nobody), in the
 * task's own project, says why the card is unassigned. `recordActivity` also
 * hints the task, and every project whose board lost the agent is hinted,
 * so open boards drop the stale name at once. A task an automation filed
 * goes back to that automation once nobody holds it, so a series it carried
 * ends here too, as the assign door ends it.
 *
 * Answers the ids it cleared, so the caller can audit or count them.
 */
export async function clearAgentAssignmentsInTx(
  tx: TransactionSql,
  args: {
    organizationId: string;
    agentId: string;
    /** The person deleting the agent — the activity's actor. */
    actorId: string;
    /** A project whose tasks go with it (its own deletion): they are left
     * as they are. */
    exceptProjectId?: string;
  },
): Promise<string[]> {
  const cleared = await tx<
    {
      id: string;
      projectId: string;
      repeat: unknown;
      createdByType: string;
    }[]
  >`
    UPDATE app.tasks SET
      assignee_type = NULL,
      assignee_id = NULL,
      updated_at_ms = ${Date.now()}
    WHERE org_id = ${args.organizationId}
      AND assignee_type = 'agent'
      AND assignee_id = ${args.agentId}
      AND project_id IS DISTINCT FROM ${args.exceptProjectId ?? null}
    RETURNING id, project_id AS "projectId", repeat_rule AS "repeat",
              created_by_type AS "createdByType"
  `;
  for (const row of cleared) {
    const task = {
      id: row.id,
      organizationId: args.organizationId,
      projectId: row.projectId,
    };
    await recordActivity(tx, {
      task,
      actorType: 'user',
      actorId: args.actorId,
      action: 'assignee.changed',
      fromValue: args.agentId,
    });
    await endRepeatForAutomationOwner(tx, {
      task: { ...task, repeat: row.repeat, createdByType: row.createdByType },
      next: { assigneeType: null, assigneeId: null },
      actorType: 'user',
      actorId: args.actorId,
    });
  }
  for (const projectId of new Set(cleared.map((row) => row.projectId))) {
    await emitHintInTx(tx, {
      orgId: args.organizationId,
      entity: 'project',
      entityId: projectId,
    });
  }
  return cleared.map((row) => row.id);
}
