import type { Sql, TransactionSql } from 'postgres';

/**
 * Where an automation run acts: pinned to its own project, or org-wide
 * across the projects its automation is bound to (none at all for an
 * automation that is truly org-level), or nowhere. `actorId` is who its
 * writes are attributed to: the AUTOMATION, not whoever started the run —
 * the same actor the engine's own task natives use.
 */
export type AutomationRunBinding =
  | { kind: 'project'; projectId: string; actorId: string }
  | { kind: 'org_run'; actorId: string; boundProjectIds: string[] }
  | { kind: 'none' };

/**
 * The projects an org-wide automation run may act on — the deploy-time
 * bindings of the automation this run belongs to.
 *
 * Read STRAIGHT off the binding rows, never joined against `projects`: an
 * empty set means "org-level, unbounded", so a join that dropped a row would
 * WIDEN this run's authority. An id whose project is gone simply matches
 * nothing downstream, which is the fail-closed direction.
 */
async function boundProjectIdsOf(
  sql: Sql | TransactionSql,
  organizationId: string,
  automationName: string,
): Promise<string[]> {
  const rows = await sql<{ projectId: string }[]>`
    SELECT project_id AS "projectId"
    FROM app.automation_project_bindings
    WHERE org_id = ${organizationId}
      AND automation_name = ${automationName}
  `;
  return rows.map((row) => row.projectId);
}

/**
 * Where the run acts, for a step that reads or writes org data as it — an
 * agent step's sandbox tools and a platform connector step alike.
 * Fail-closed: a run that is gone, or pinned to a project whose row is
 * gone, resolves to `none` rather than widening to the org.
 */
export async function resolveAutomationRunBinding(
  sql: Sql | TransactionSql,
  organizationId: string,
  runId: string,
): Promise<AutomationRunBinding> {
  const runs = await sql<{ name: string; projectId: string | null }[]>`
    SELECT name, project_id AS "projectId" FROM app.automation_runs
    WHERE id = ${runId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  const run = runs[0];
  if (!run) return { kind: 'none' };
  const actorId = `automation:${run.name}`;
  if (run.projectId !== null) {
    const projects = await sql<{ id: string }[]>`
      SELECT id FROM app.projects
      WHERE id = ${run.projectId} AND org_id = ${organizationId}
      LIMIT 1
    `;
    if (projects.length === 0) return { kind: 'none' };
    return { kind: 'project', projectId: run.projectId, actorId };
  }
  return {
    kind: 'org_run',
    actorId,
    boundProjectIds: await boundProjectIdsOf(sql, organizationId, run.name),
  };
}
