import type { Sql } from 'postgres';

/** What the label read needs of a task: the ids it wears, and the project
 * whose catalog those ids must belong to. */
interface AgentLabelledTask {
  id: string;
  projectId: string;
  labelIds: readonly string[];
}

/**
 * The labels an agent reads on a task (`task_find`'s rows, `task_get`'s task
 * and the brief a run of the task opens with, `task-brief-read.ts`): each
 * name as its project's catalog spells it, sorted without regard to case,
 * `[]` for a task that wears none. A team steers its agents with
 * labels — one that holds a task back, one that waits for a person — and an
 * agent that cannot read them cannot honour them.
 *
 * One read answers a whole page. It is scoped to the organization, and a label
 * counts only on a task of the project whose catalog holds it, so an id that
 * names nothing in that catalog (deleted, or another project's) names no label
 * here.
 */
export async function readAgentTaskLabels(
  sql: Sql,
  organizationId: string,
  tasks: readonly AgentLabelledTask[],
): Promise<Map<string, string[]>> {
  const ids = [...new Set(tasks.flatMap((task) => task.labelIds))];
  const rows =
    ids.length === 0
      ? []
      : await sql<{ id: string; projectId: string; name: string }[]>`
          SELECT id, project_id AS "projectId", name FROM app.task_labels
          WHERE org_id = ${organizationId} AND id = ANY(${ids})
        `;
  const byId = new Map(rows.map((row) => [row.id, row]));
  return new Map(
    tasks.map((task) => {
      const names = new Set<string>();
      for (const id of task.labelIds) {
        const label = byId.get(id);
        if (label !== undefined && label.projectId === task.projectId) {
          names.add(label.name);
        }
      }
      return [task.id, [...names].sort(compareLabelNames)];
    }),
  );
}

/** Case-folded first, so `blocked` comes before `Hold`; the spelling breaks a
 * tie. Code-unit order, the same whatever the database's collation. */
function compareLabelNames(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left !== right) return left < right ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
