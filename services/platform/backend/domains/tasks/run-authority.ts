import type { Sql, TransactionSql } from 'postgres';

import {
  parseRunStarter,
  runStarterUserId,
} from '../../../lib/shared/run-starter.ts';
import {
  isStandingProjectAgentSession,
  memberSessionIdForProjectAgent,
  standingSessionIdForProjectAgent,
} from '../../core/sandbox/session_naming.ts';
import { dispatchReachesSource } from './dispatch-reach.ts';
import { memberEditableProjects } from './edit-right.ts';

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
 * A run the project's dispatch started (`dispatch-pass.ts`) names the
 * project's dispatch (`dispatch:<projectId>`) and no person either. It acts
 * with the agent's full equipment in the standing workspace while the
 * project's dispatch is switched on and the project is active — on a task
 * of another board only while the dispatch still reaches that board as a
 * source (`dispatch-reach.ts`); switching dispatch off, or the source
 * becoming unreachable, confines its runs the same way.
 *
 * The workspace family is chosen when the run is kicked, by the starter's
 * rights then, and checked again whenever the run starts: its turn job
 * claims a worker of the family (`agent-workers.ts`) and moves a run whose
 * starter lost the Editor role while it waited into the member's own
 * family, never the other way round. A run in a member's workspace stays
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

/** Whether a project's dispatch may act in a project: the dispatch the
 * starter names is switched on and its project is not archived, and the
 * project is that dispatch's own or one of its sources it reaches now
 * (`dispatch-reach.ts`). */
export async function dispatchMayActInProject(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    dispatchProjectId: string;
  },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    SELECT d.project_id AS id FROM app.project_dispatch d
    JOIN app.projects p ON p.id = d.project_id AND p.org_id = d.org_id
    WHERE d.project_id = ${args.dispatchProjectId}
      AND d.org_id = ${args.organizationId}
      AND d.enabled = true AND p.archived_at_ms IS NULL
    LIMIT 1
  `;
  if (rows.length === 0) return false;
  if (args.dispatchProjectId === args.projectId) return true;
  return dispatchReachesSource(sql, args);
}

/** Whether a run's starter may act in the project with the agent's full
 * equipment now: the person it names is a live member of the organization
 * with the Editor role or higher and the project's audience, the schedule it
 * names may act there ({@link scheduleMayActInProject}), or the project's
 * dispatch it names is switched on ({@link dispatchMayActInProject}). A
 * starter that names nobody usable may not. */
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
  if (starter.kind === 'dispatch') {
    return dispatchMayActInProject(sql, {
      organizationId: args.organizationId,
      projectId: args.projectId,
      dispatchProjectId: starter.projectId,
    });
  }
  const userId = runStarterUserId(args.startedBy);
  if (userId === null) return false;
  // A starter may be an API key that is not a person: it acts with the role
  // it was made with, and the audience it was given.
  const editable = await memberEditableProjects(sql, {
    organizationId: args.organizationId,
    userId,
    projectIds: [args.projectId],
  });
  return editable.has(args.projectId);
}

/** The workspace family a run of the agent works in, by who starts it — as
 * its first worker, the session a kick names: the agent's standing family
 * for a project editor (or a schedule that may act in the project), the
 * member's own family with this agent for anyone else. */
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
