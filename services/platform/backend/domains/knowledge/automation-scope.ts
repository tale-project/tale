import type { Sql } from 'postgres';

import type { KnowledgeAccessScope } from '../../../lib/knowledge/types.ts';
import { PROJECT_TEAM_IDS_SQL } from '../../core/lib/audience.ts';

/**
 * The knowledge scope over a set of ALREADY-AUTHORIZED projects: each
 * project's team and shared teams, the org pseudo-team, the hub, and the
 * archived subset (labelling only). One helper for every binding — a project
 * session reads its one project, an org-wide run of a multi-bound automation
 * reads its bound projects. Built from the `projects` rows that EXIST: a bound
 * id whose project is gone contributes nothing (the fail-closed direction),
 * never a widening.
 */
export async function projectsKnowledgeScope(
  sql: Sql,
  organizationId: string,
  projectIds: readonly string[],
): Promise<{
  teamIds: string[];
  projectIds: string[];
  includeHub: boolean;
  archivedProjectIds: string[];
}> {
  const rows = await sql<
    {
      id: string;
      teamIds: string[] | null;
      archivedAt: number | null;
    }[]
  >`
    SELECT id, ${sql.unsafe(PROJECT_TEAM_IDS_SQL)} AS "teamIds",
           archived_at_ms::float8 AS "archivedAt"
    FROM app.projects
    WHERE id = ANY(${[...projectIds]}) AND org_id = ${organizationId}
    ORDER BY created_at_ms, id
  `;
  const teamIds = new Set<string>();
  const archivedProjectIds: string[] = [];
  for (const row of rows) {
    for (const teamId of row.teamIds ?? []) teamIds.add(teamId);
    if (row.archivedAt != null) archivedProjectIds.push(row.id);
  }
  return {
    teamIds: [...teamIds],
    projectIds: rows.map((row) => row.id),
    includeHub: true,
    archivedProjectIds,
  };
}

/** The projects an automation run acts in: its own project, or the
 * projects its automation is bound to when it runs for the whole
 * organization. */
export interface AutomationRunProjects {
  /** The run's own project, when it runs in one. */
  readonly projectId?: string;
  /** The projects the automation is bound to; none for an org-level one. */
  readonly boundProjectIds?: readonly string[];
}

/**
 * What an automation run reads of the organization's knowledge — the same
 * answer for an agent step's search inside a sandbox and for a search step:
 *
 *  - a run in a project reads that project, plus the hub;
 *  - an org-wide run of an automation bound to projects reads ITS bound
 *    projects' files — the projects its task and document actions are
 *    confined to — plus the hub. Hub-only here made the very documents the
 *    run was deployed over `not_found` mid-run;
 *  - an automation with NO bindings is org-level: it reads the org HUB — the
 *    knowledge every member shares — not the union of every project's
 *    attached files, and no team library.
 *
 * Never the conversation-scoped rows (thread uploads, mail): a run reads as
 * no member.
 */
export async function automationRunKnowledgeScope(
  sql: Sql,
  organizationId: string,
  run: AutomationRunProjects,
): Promise<KnowledgeAccessScope> {
  const projectIds =
    run.projectId !== undefined ? [run.projectId] : (run.boundProjectIds ?? []);
  if (projectIds.length > 0) {
    return projectsKnowledgeScope(sql, organizationId, projectIds);
  }
  return {
    teamIds: [],
    projectIds: [],
    includeHub: true,
    archivedProjectIds: [],
  };
}
