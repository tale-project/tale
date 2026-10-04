import type { TransactionSql } from 'postgres';

/** The open predecessors that hold task work, in stable order. The caller
 * has already scoped the target task to its organization and project. */
export async function openTaskBlockerIds(
  tx: TransactionSql,
  taskId: string,
): Promise<string[]> {
  const rows = await tx<{ id: string }[]>`
    SELECT t.id FROM app.task_dependencies d
    JOIN app.tasks t ON t.id = d.blocker_task_id
    WHERE d.blocked_task_id = ${taskId}
      AND t.status NOT IN ('done', 'cancelled')
    ORDER BY t.id
  `;
  return rows.map((row) => row.id);
}
