import type { Sql } from 'postgres';

import { PROJECT_TEAM_IDS_SQL } from '../../core/lib/audience.ts';

/**
 * The teams a project agent's skills resolve against: a project agent's
 * equipment is the PROJECT's, so a team skill is visible to it only when
 * the project is shared with that team — never because of whoever configured
 * the agent or whoever starts a run. `null` when the agent is gone; an empty
 * list is an organization-wide project, which sees organization skills only.
 *
 * One reader for both engines a run can execute on: the harness stages the
 * equipped skills as files, a native turn loads them through its skill tools,
 * and both ask for the same viewer.
 */
export async function readProjectAgentSkillScope(
  sql: Sql,
  agentId: string,
): Promise<{ teamIds: string[] } | null> {
  // `app.project_agents` carries no team columns, so the audience
  // expression's bare column names resolve to the project's.
  const rows = await sql<{ teamIds: string[] | null }[]>`
    SELECT ${sql.unsafe(PROJECT_TEAM_IDS_SQL)} AS "teamIds"
    FROM app.project_agents a
    JOIN app.projects p ON p.id = a.project_id
    WHERE a.id = ${agentId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { teamIds: row.teamIds ?? [] };
}
