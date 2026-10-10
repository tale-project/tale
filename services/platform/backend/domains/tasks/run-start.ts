import type { Sql, TransactionSql } from 'postgres';

import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { TaskError } from './errors.ts';

/** New task work obeys the same master switch the mention preview shows.
 * Read fresh so a recently disabled policy cannot start another paid turn. */
export async function taskAutomationEnabled(
  tx: Sql | TransactionSql,
  organizationId: string,
): Promise<boolean> {
  const policy = await readGovernancePolicyForOrg(
    tx,
    organizationId,
    'task_automation',
    { strict: true },
  ).catch(() => {
    throw new TaskError(
      'TASK_AUTOMATION_UNAVAILABLE',
      'Task automation policy is unavailable; restore valid configuration before starting work',
      409,
    );
  });
  return policy?.enabled !== false;
}

/** Whether an @mention may start work: the same switch, with a broken
 * policy read as off. It blocks the automatic start, not the comment or the
 * description edit that asked for one; explicit start actions keep their
 * actionable configuration error. */
export async function mentionAutomationEnabled(
  tx: Sql | TransactionSql,
  organizationId: string,
): Promise<boolean> {
  try {
    return await taskAutomationEnabled(tx, organizationId);
  } catch (error) {
    if (
      error instanceof TaskError &&
      error.code === 'TASK_AUTOMATION_UNAVAILABLE'
    ) {
      return false;
    }
    throw error;
  }
}

export async function assertTaskAutomationEnabled(
  tx: TransactionSql,
  organizationId: string,
): Promise<void> {
  if (!(await taskAutomationEnabled(tx, organizationId))) {
    throw new TaskError(
      'TASK_AUTOMATION_DISABLED',
      'Task automation is disabled for this organization',
      403,
    );
  }
}

/** Both engines contend on the task before inspecting either run table.
 * A write, rather than a SELECT FOR UPDATE, also invalidates an overlapping
 * SERIALIZABLE snapshot: after retry it can see the winner in the other
 * engine's table. No task field changes and no activity is emitted. */
export async function lockTaskRunStart(
  tx: TransactionSql,
  organizationId: string,
  taskId: string,
): Promise<void> {
  await tx`
    UPDATE app.tasks SET updated_at_ms = updated_at_ms
    WHERE id = ${taskId} AND org_id = ${organizationId}
  `;
}

/** The decision an in-place kick continues. The caller holds the task lock:
 * native status/assignment/archive/review writers take it too, so the cursor
 * cannot race those decisions. bigint stays text; a JS number can lose a move.
 * Comments and other metadata leave the original work authorized. */
export async function readInPlaceRetryState(
  tx: TransactionSql,
  organizationId: string,
  taskId: string,
): Promise<{ status: string; activityId: string } | undefined> {
  const rows = await tx<{ status: string; activityId: string }[]>`
    SELECT status, coalesce((
      SELECT id FROM app.task_activity
      WHERE task_id = ${taskId} AND org_id = ${organizationId}
        AND action IN ('status.changed', 'assignee.changed', 'archived', 'restored', 'review.responded')
      ORDER BY id DESC LIMIT 1
    ), 0)::text AS "activityId"
    FROM app.tasks
    WHERE id = ${taskId} AND org_id = ${organizationId}
  `;
  return rows[0];
}

/** The agent row as a start locks it: what the kick needs to run it. */
export interface LockedAgent {
  id: string;
  projectId: string;
  harness: string;
  model: string;
  modelProvider: string | null;
}

/**
 * Share delegated admission's agent row fence with managed review-context
 * enrollment. A write invalidates an overlapping SERIALIZABLE snapshot too.
 * Callers that lock both take the agent before the task; worker capacity is
 * owned separately by agent-workers.ts. Null means no matching agent.
 */
export async function lockAgentForStart(
  tx: TransactionSql,
  args: { organizationId: string; agentId: string; projectId?: string },
): Promise<LockedAgent | null> {
  const agents = await tx<LockedAgent[]>`
    UPDATE app.project_agents SET updated_at_ms = updated_at_ms
    WHERE id = ${args.agentId} AND org_id = ${args.organizationId}
      AND (${args.projectId ?? null}::text IS NULL
           OR project_id = ${args.projectId ?? null})
    RETURNING id, project_id AS "projectId", harness, model,
              model_provider AS "modelProvider"
  `;
  return agents[0] ?? null;
}
