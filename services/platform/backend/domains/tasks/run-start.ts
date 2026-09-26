import type { TransactionSql } from 'postgres';

import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { TaskError } from './errors.ts';

/** New task work obeys the same master switch the mention preview shows.
 * Read fresh so a recently disabled policy cannot start another paid turn. */
export async function taskAutomationEnabled(
  tx: TransactionSql,
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
