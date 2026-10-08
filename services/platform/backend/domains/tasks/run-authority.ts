import type { Sql, TransactionSql } from 'postgres';

import {
  parseRunStarter,
  runStarterUserId,
} from '../../../lib/shared/run-starter.ts';
import { findActingMember, getUserTeamIds } from '../../auth/membership.ts';
import { PROJECT_TEAM_IDS_SQL } from '../../core/lib/audience.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';
import {
  isStandingProjectAgentSession,
  memberSessionIdForProjectAgent,
  standingSessionIdForProjectAgent,
} from '../../core/sandbox/session_naming.ts';

/**
 * What a project agent's run may do follows the person who started it.
 *
 * A run a project editor started (the Editor role or higher, with the
 * project's audience) acts with the agent's full equipment: its secrets and
 * brokered credentials in the sandbox, its task and document tools across
 * the project, in the agent's standing workspace. A run a member started —
 * someone who may create tasks and work their own, but not edit the project
 * — is CONFINED: its tools change only its own task and the subtasks under
 * it, it creates no labels, syncs no external items and saves no project
 * documents, the agent's secrets and the GitHub token stay out of its
 * sandbox, and it works in a workspace of its own (one per agent and
 * member), so nothing it leaves behind reaches a later editor's run.
 *
 * A run a schedule began — an automation's `task.start_agent` step on a
 * schedule's occurrence, or an agent that run delegated to
 * (`delegated-start.ts`) — names the schedule as its starter
 * (`trigger:<triggerId>`) and no person. It acts with the agent's full
 * equipment in the standing workspace for as long as the schedule may act
 * in the project: an ENABLED schedule of an automation bound to it. Pausing
 * or removing the schedule, or unbinding its automation from the project,
 * confines the chain's runs at their next tool call, as a member's lost
 * Editor role does.
 *
 * The workspace is chosen when the run is kicked, by the starter's rights
 * then, and is fixed for the run's life: a run in a member's workspace stays
 * confined whoever steers it later. Everything else is judged against the
 * starter's rights at the moment it is asked (each tool call, each start or
 * restart), so a member who loses the Editor role mid-run stops acting as one.
 */

/** Whether the schedule a run's starter names may still act in the project:
 * an enabled schedule trigger of an automation bound to that project. A
 * webhook or event trigger never may — nothing a sender or a platform event
 * fires puts a project agent to work. */
export async function scheduleMayActInProject(
  sql: Sql | TransactionSql,
  args: { organizationId: string; projectId: string; triggerId: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    SELECT t.id FROM app.automation_triggers t
    JOIN app.automation_project_bindings b
      ON b.org_id = t.org_id AND b.automation_name = t.name
     AND b.project_id = ${args.projectId}
    WHERE t.id = ${args.triggerId} AND t.org_id = ${args.organizationId}
      AND t.kind = 'schedule' AND t.enabled = true
    LIMIT 1
  `;
  return rows.length > 0;
}

/** Whether a run's starter may act in the project with the agent's full
 * equipment now: the person it names is a live member of the organization
 * with the Editor role or higher and the project's audience, or the schedule
 * it names may act there ({@link scheduleMayActInProject}). A starter that
 * names nobody usable may not. */
export async function runStarterMayEditProject(
  sql: Sql | TransactionSql,
  args: { organizationId: string; projectId: string; startedBy: string },
): Promise<boolean> {
  const starter = parseRunStarter(args.startedBy);
  if (starter.kind === 'trigger') {
    return scheduleMayActInProject(sql, {
      organizationId: args.organizationId,
      projectId: args.projectId,
      triggerId: starter.triggerId,
    });
  }
  const userId = runStarterUserId(args.startedBy);
  if (userId === null) return false;
  // A starter may be an API key that is not a person: it acts with the role
  // it was made with, and the audience it was given.
  const member = await findActingMember(sql, args.organizationId, userId);
  if (member === null) return false;
  const role = member.role.toLowerCase();
  if (role === 'disabled') return false;
  const projects = await sql<{ teamIds: string[] | null }[]>`
    SELECT ${sql.unsafe(PROJECT_TEAM_IDS_SQL)} AS "teamIds"
    FROM app.projects
    WHERE id = ${args.projectId} AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  const project = projects[0];
  if (project === undefined) return false;
  const teamIds = await getUserTeamIds(sql, args.organizationId, userId);
  return checkProjectAccess({ teamIds: project.teamIds ?? [] }, teamIds, role)
    .canEdit;
}

/** The session a new run of the agent works in, by who starts it: the
 * agent's standing workspace for a project editor (or a schedule that may
 * act in the project), the member's own workspace with this agent for
 * anyone else. */
export async function sessionIdForAgentRun(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    agentId: string;
    startedBy: string;
  },
): Promise<string> {
  if (await runStarterMayEditProject(sql, args)) {
    return standingSessionIdForProjectAgent(args.agentId);
  }
  return memberSessionIdForProjectAgent(
    args.agentId,
    runStarterUserId(args.startedBy) ?? args.startedBy,
  );
}

/** Whether the run is confined to its own task (see the module comment): it
 * works in a member's workspace, or its starter may not edit the project. */
export async function isTaskRunConfined(
  sql: Sql | TransactionSql,
  run: {
    organizationId: string;
    projectId: string;
    agentId: string;
    sessionId: string;
    startedBy: string;
  },
): Promise<boolean> {
  if (!isStandingProjectAgentSession(run.agentId, run.sessionId)) return true;
  return !(await runStarterMayEditProject(sql, run));
}
