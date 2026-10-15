import type { Sql } from 'postgres';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import { runStarterUserId } from '../../../lib/shared/run-starter.ts';
import type { SkillViewer } from '../../../lib/skills/visibility.ts';
import { findActingMember, getActingAudience } from '../../auth/membership.ts';
import { PROJECT_TEAM_IDS_SQL } from '../../core/lib/audience.ts';
import { runProjectScope } from './run-authority.ts';

/** The teams a project agent's skills resolve against, and — for a run that
 * may not read the agent's own project — whose sight narrows them. */
export interface ProjectAgentSkillScope {
  teamIds: string[];
  /** Present for a run whose starter may not read the agent's own project
   * (`runProjectScope`): of the agent's skills, it stages only the ones
   * this viewer may see too [TASK-R82]. */
  starter?: SkillViewer;
}

/**
 * The teams a project agent's skills resolve against: a project agent's
 * equipment is the PROJECT's, so a team skill is visible to it only when
 * the project is shared with that team — never because of whoever configured
 * the agent or whoever starts a run. `null` when the agent is gone; an empty
 * list is an organization-wide project, which sees organization skills only.
 *
 * Given a run, it also answers whose sight narrows them: a run on another
 * project's board whose starter may not read the agent's own project reads
 * nothing of that project [TASK-R82], and the skills shared with its
 * project's teams are part of it. Such a run stages only the skills its
 * starter may see as well ({@link starterSkillViewer}).
 *
 * One reader for both engines a run can execute on: the harness stages the
 * equipped skills as files, a native turn loads them through its skill tools,
 * and both ask for the same viewer.
 */
export async function readProjectAgentSkillScope(
  sql: Sql,
  agentId: string,
  runId?: string,
): Promise<ProjectAgentSkillScope | null> {
  // `app.project_agents` carries no team columns, so the audience
  // expression's bare column names resolve to the project's.
  const rows = await sql<
    { teamIds: string[] | null; projectId: string; organizationId: string }[]
  >`
    SELECT ${sql.unsafe(PROJECT_TEAM_IDS_SQL)} AS "teamIds",
           a.project_id AS "projectId", a.org_id AS "organizationId"
    FROM app.project_agents a
    JOIN app.projects p ON p.id = a.project_id
    WHERE a.id = ${agentId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const scope: ProjectAgentSkillScope = { teamIds: row.teamIds ?? [] };
  if (runId === undefined) return scope;
  const runs = await sql<{ projectId: string; startedBy: string }[]>`
    SELECT project_id AS "projectId", started_by AS "startedBy"
    FROM app.project_agent_runs
    WHERE id = ${runId} AND agent_id = ${agentId} AND org_id = ${row.organizationId}
    LIMIT 1
  `;
  const run = runs[0];
  // A run that is gone stages nothing it was not already given: its start
  // fails on the run's own checks.
  if (run === undefined || run.projectId === row.projectId) return scope;
  const reach = await runProjectScope(sql, {
    organizationId: row.organizationId,
    homeProjectId: row.projectId,
    reachedProjectIds: [],
    run,
  });
  if (reach.ownProject) return scope;
  return {
    ...scope,
    starter: await starterSkillViewer(sql, row.organizationId, run.startedBy),
  };
}

/**
 * What a run's starter may see of the skill library: a person, or an API
 * key acting with the role and audience it was given, sees what they see in
 * the app; a schedule, the dispatch, or a person no longer in the
 * organization sees the organization's own skills alone.
 */
async function starterSkillViewer(
  sql: Sql,
  organizationId: string,
  startedBy: string,
): Promise<SkillViewer> {
  const userId = runStarterUserId(startedBy);
  if (userId === null) return { kind: 'org' };
  const member = await findActingMember(sql, organizationId, userId);
  if (member === null || member.role.toLowerCase() === 'disabled') {
    return { kind: 'org' };
  }
  const audience = await getActingAudience(sql, organizationId, userId);
  return {
    kind: 'user',
    userId,
    teamIds: [...audience.teamIds],
    isOrgAdmin: defineAbilityFor(member.role).can('write', 'orgSettings'),
  };
}
