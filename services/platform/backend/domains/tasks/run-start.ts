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
