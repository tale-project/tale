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
import {
  agentReachesProject,
  dispatchReachesSource,
  readAgentHome,
} from './dispatch-reach.ts';
import {
  memberEditableProjects,
  memberReadableProjects,
} from './edit-right.ts';

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
 * A run of an agent on another project's board — one its own project's
 * dispatch serves — answers to both projects: its starter acts with the
 * agent's full equipment only while it may act in the board's project AND
 * in the agent's own, and while the agent still reaches the board
 * ({@link runStarterMayActWithAgent}). Someone who edits only the served
 * board gets a confined run in a workspace of their own: the agent's
 * secrets, credentials and standing workspace belong to its own project.
 * And it reads only what its starter may read ({@link runProjectScope}):
 * its task, document and knowledge tools leave out the agent's own project
 * when the person who started, woke, moved or retried it may not read that
 * project, and reach the other boards only as far as that person may edit
 * them. A run the dispatch started there acts for whoever last saved the
 * dispatch — on whose right to edit the board the dispatch serves it
 * (`dispatch-reach.ts`) — and keeps the agent's own project's reach.
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
  return (
    await runStarterActingProjects(sql, {
      organizationId: args.organizationId,
      startedBy: args.startedBy,
      projectIds: [args.projectId],
    })
  ).has(args.projectId);
}

/** Which of the named projects a run's starter may act in with the agent's
 * full equipment now, each judged as {@link runStarterMayEditProject}
 * judges one. */
async function runStarterActingProjects(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    startedBy: string;
    projectIds: readonly string[];
  },
): Promise<Set<string>> {
  const projectIds = [...new Set(args.projectIds)];
  const acting = new Set<string>();
  if (projectIds.length === 0) return acting;
  const starter = parseRunStarter(args.startedBy);
  if (starter.kind === 'trigger' || starter.kind === 'dispatch') {
    for (const projectId of projectIds) {
      const may =
        starter.kind === 'trigger'
          ? await scheduleMayActInProject(sql, {
              organizationId: args.organizationId,
              projectId,
              triggerId: starter.triggerId,
            })
          : await dispatchMayActInProject(sql, {
              organizationId: args.organizationId,
              projectId,
              dispatchProjectId: starter.projectId,
            });
      if (may) acting.add(projectId);
    }
    return acting;
  }
  const userId = runStarterUserId(args.startedBy);
  if (userId === null) return acting;
  // A starter may be an API key that is not a person: it acts with the role
  // it was made with, and the audience it was given.
  return memberEditableProjects(sql, {
    organizationId: args.organizationId,
    userId,
    projectIds,
  });
}

/**
 * Whether a run's starter may act with the agent's full equipment on a task
 * of the project now. On the agent's own project's board that is
 * {@link runStarterMayEditProject}. On a board its project's dispatch serves
 * (`dispatch-reach.ts`), the agent must still reach that board, and the
 * starter must be able to act in both the board's project and the agent's
 * own: the agent's secrets, credentials and standing workspace are its own
 * project's, and nobody gets them by editing only a board it serves. An
 * agent no longer in the organization reaches no other board, and its run
 * is judged on the task's project alone.
 */
async function runStarterMayActWithAgent(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    agentId: string;
    startedBy: string;
  },
): Promise<boolean> {
  const home = await readAgentHome(sql, args);
  if (home === null || home.projectId === args.projectId) {
    return runStarterMayEditProject(sql, args);
  }
  if (!(await agentReachesProject(sql, args))) return false;
  const acting = await runStarterActingProjects(sql, {
    organizationId: args.organizationId,
    startedBy: args.startedBy,
    projectIds: [args.projectId, home.projectId],
  });
  return acting.has(args.projectId) && acting.has(home.projectId);
}

/** What a run's task, document and knowledge tools reach of the projects
 * around it ({@link runProjectScope}). */
export interface RunProjectScope {
  /** Whether they reach the agent's own project. */
  ownProject: boolean;
  /** The other boards its task tools reach. */
  reachedProjectIds: string[];
}

/**
 * What a run's tools reach beyond its own task, by who started it.
 *
 * A run the agent's own project's dispatch started reaches the agent's
 * project and every board that dispatch serves now (`reachedProjectIds`,
 * `dispatch-reach.ts`): the dispatch's reach is the agent's, on the right of
 * whoever last saved it.
 *
 * Any other run reaches, of the boards the agent reaches, the ones its
 * starter may act in ({@link runStarterActingProjects}). On the agent's own
 * board it reads the agent's project, and nothing else changes. On another
 * board it reads only what its starter may read: the agent's own project
 * and its own task's board each only while the person who started it may
 * read them ({@link memberReadableProjects}) — or, for a schedule, while it
 * may act there. Nobody reads a project they may not read by starting an
 * agent another project's dispatch puts on their board.
 */
export async function runProjectScope(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    /** The agent's own project. */
    homeProjectId: string;
    /** The boards the agent reaches now. */
    reachedProjectIds: readonly string[];
    run: { projectId: string; startedBy: string };
  },
): Promise<RunProjectScope> {
  const onOwnBoard = args.run.projectId === args.homeProjectId;
  if (onOwnBoard && args.reachedProjectIds.length === 0) {
    return { ownProject: true, reachedProjectIds: [] };
  }
  const starter = parseRunStarter(args.run.startedBy);
  if (starter.kind === 'dispatch' && starter.projectId === args.homeProjectId) {
    return { ownProject: true, reachedProjectIds: [...args.reachedProjectIds] };
  }
  const acting = await runStarterActingProjects(sql, {
    organizationId: args.organizationId,
    startedBy: args.run.startedBy,
    projectIds: args.reachedProjectIds.filter(
      (projectId) => projectId !== args.run.projectId,
    ),
  });
  const readable = onOwnBoard
    ? null
    : await runStarterReadableProjects(sql, {
        organizationId: args.organizationId,
        startedBy: args.run.startedBy,
        projectIds: [args.homeProjectId, args.run.projectId],
      });
  const reads = (projectId: string) =>
    readable === null || readable.has(projectId);
  return {
    ownProject: reads(args.homeProjectId),
    reachedProjectIds: args.reachedProjectIds.filter((projectId) =>
      projectId === args.run.projectId
        ? reads(projectId)
        : acting.has(projectId),
    ),
  };
}

/** Which of the named projects a run's starter may read now: a person or an
 * API key the projects their role and audience read
 * ({@link memberReadableProjects}); a schedule or a dispatch, which read as
 * no person, the projects it may act in ({@link runStarterActingProjects}). */
async function runStarterReadableProjects(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    startedBy: string;
    projectIds: readonly string[];
  },
): Promise<Set<string>> {
  const kind = parseRunStarter(args.startedBy).kind;
  if (kind === 'trigger' || kind === 'dispatch') {
    return runStarterActingProjects(sql, args);
  }
  const userId = runStarterUserId(args.startedBy);
  if (userId === null) return new Set();
  return memberReadableProjects(sql, {
    organizationId: args.organizationId,
    userId,
    projectIds: [...new Set(args.projectIds)],
  });
}

/** The workspace family a run of the agent works in, by who starts it — as
 * its first worker, the session a kick names: the agent's standing family
 * for a starter who may act with the agent's full equipment on the task
 * ({@link runStarterMayActWithAgent}), the member's own family with this
 * agent for anyone else. */
export async function sessionIdForAgentRun(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    agentId: string;
    startedBy: string;
  },
): Promise<string> {
  if (await runStarterMayActWithAgent(sql, args)) {
    return standingSessionIdForProjectAgent(args.agentId);
  }
  return memberSessionIdForProjectAgent(
    args.agentId,
    runStarterUserId(args.startedBy) ?? args.startedBy,
  );
}

/** Whether the run is confined to its own task (see the module comment): it
 * works in a member's workspace, or its starter may not act with the agent's
 * full equipment on the task ({@link runStarterMayActWithAgent}). */
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
  return !(await runStarterMayActWithAgent(sql, run));
}
