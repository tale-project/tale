import type { TransactionSql } from 'postgres';

import { parseRunStarter } from '../../../lib/shared/run-starter.ts';
import { standingSessionIdForProjectAgent } from '../../core/sandbox/session_naming.ts';
import { loadProjectOrThrow } from '../projects/service.ts';
import { kickAgentRun, type StartedVia } from './agent-runs.ts';
import { TaskError } from './errors.ts';
import {
  isTaskRunConfined,
  runStarterMayEditProject,
} from './run-authority.ts';
import { assertTaskAutomationEnabled } from './run-start.ts';
import {
  agentAssignTaskToAgentTrusted,
  agentHandTaskToInProgressTrusted,
  loadTaskOrThrow,
  recordActivity,
  TERMINAL_STATUSES,
} from './service.ts';

/**
 * A project agent put to work by something other than a person's own Start:
 * an automation's `task.start_agent` step (a schedule's occurrence, or a run
 * a person started), or another project agent's run through the granted
 * `task_start_agent` tool. One admission for both doors, over the same kick
 * a person's Start uses (`kickAgentRun`), so the run is an ordinary run of
 * the agent with its provenance on the row (migration 0139).
 *
 * Who it answers to. The started run inherits the door the requesting run
 * answers to — `startedBy`: the person who started it (a bare id), or the
 * schedule that began the chain (`trigger:<id>`). That starter must be able
 * to act in the task's project with the agent's full equipment NOW
 * (`runStarterMayEditProject`: an Editor or higher with the project's
 * audience, or an enabled schedule of an automation bound to the project),
 * and it is judged again at every start, so a lost role, a paused or
 * removed schedule or an unbound automation stops the next start. Nobody
 * is impersonated: a schedule's chain names no person and books under the
 * automation subject, and the run and the timeline name the automation or
 * the agent that asked.
 *
 * What it refuses (throws): a task outside the requester's project (opaque,
 * like a missing one), an archived task or project, a starter that may no
 * longer act there, task automation switched off, no agent to start, an
 * agent that belongs to another project, an automation holding the task,
 * and a second hop — an agent another agent started may not put further
 * agents to work (a retried one neither).
 *
 * What it answers instead of starting (never throws, so the requester can
 * go on with other work and the answer is recorded as it is):
 *
 * - `already_running` — the task's live run carries the work (one live run
 *   per task, 0080): a schedule's occurrence that finds its role still
 *   working is coalesced, not queued behind it;
 * - `in_review` / `closed` — an in-place start (`moveToInProgress: false`)
 *   under a card that waits for a person's review, or one already Done or
 *   Cancelled: the card would go on presenting the previous work for
 *   judgment (or as finished) while new work runs under it, and the pending
 *   review would refer to superseded work. Nothing is assigned or started;
 *   the default start moves the card and withdraws the review instead;
 * - `agent_busy` — the agent is working another task in its standing
 *   workspace, which every run it is started for here shares: one active
 *   piece of work per agent workspace;
 * - `blocked` — a task this one depends on is still open;
 * - `paused` — the per-task circuit breaker: at most
 *   {@link AUTOMATED_STARTS_PER_TASK_PER_HOUR} starts by automations and
 *   agents per task in any rolling hour, so two agents (or an agent and a
 *   schedule) cannot restart one task in a loop. The refusal lands on the
 *   task's timeline (`agent_run.refused`, `task_circuit_breaker`); a person's
 *   own Start is never counted or refused by it.
 *
 * The slot receipt: an automation step starts a task at most once per
 * automation run (the 0139 unique index) — a step the engine delivers again
 * finds the run the first delivery started and answers it (`replayed`).
 *
 * The card: `moveToInProgress` (the default) moves it to In progress, as
 * Start agent does, withdrawing a pending review (never approving one), and
 * the settle parks it at In review for a person. `false` leaves it where it
 * is — a standing task in To do that reports on every occurrence — and a
 * settle only parks a card that is In progress, so such a run asks for no
 * review. It starts only under open work (Backlog, To do, In progress):
 * see `in_review` / `closed` above.
 */

/** Why a run a schedule began failed without launching: the schedule was
 * paused, removed or unbound between the kick and the turn's start. */
export const SCHEDULE_REVOKED_BEFORE_LAUNCH =
  'The schedule that started this run was paused or removed, or its automation is no longer bound to the project, before the run launched — nothing ran.';

/** Starts by automations and agents one task takes in any rolling hour
 * before the circuit breaker refuses the next. */
export const AUTOMATED_STARTS_PER_TASK_PER_HOUR = 3;

const HOUR_MS = 60 * 60 * 1000;

/** The actor an automation's writes are recorded as on the task timeline —
 * the engine's task natives use the same sentinel. */
const WORKFLOW_ACTOR_ID = 'workflow';

export interface DelegatedAgentStartArgs {
  organizationId: string;
  /** The projects the requester may reach: its session's or run's project,
   * or the projects its automation is bound to. */
  scopeProjectIds: readonly string[];
  taskId: string;
  /** The door the started run answers to — the requesting run's starter. */
  startedBy: string;
  via: StartedVia;
  /** Assign the task to this agent of the task's project first. */
  agentId?: string;
  /** What the started run addresses first. */
  feedback?: string;
  /** Move the card to In progress (default) or leave it where it is. */
  moveToInProgress?: boolean;
}

export type DelegatedAgentStart =
  | {
      outcome: 'started';
      runId: string;
      taskId: string;
      agentId: string;
      /** The step's first delivery started this run; this one found it. */
      replayed?: true;
    }
  | {
      outcome: 'already_running';
      runId: string;
      taskId: string;
      agentId: string;
    }
  | {
      /** An in-place start refused: a person's review is pending. */
      outcome: 'in_review';
      taskId: string;
      agentId: string;
    }
  | {
      /** An in-place start refused: the card is Done or Cancelled. */
      outcome: 'closed';
      taskId: string;
      agentId: string;
      taskStatus: string;
    }
  | {
      outcome: 'agent_busy';
      /** The agent's live run on the other task. */
      runId: string;
      busyTaskId: string;
      taskId: string;
      agentId: string;
    }
  | {
      outcome: 'blocked';
      taskId: string;
      agentId: string;
      /** The open tasks this one depends on. */
      blockedBy: string[];
    }
  | {
      outcome: 'paused';
      taskId: string;
      agentId: string;
      /** When the oldest counted start leaves the window. */
      retryAfter: number;
    };

/** The one refusal a task outside the requester's reach gets — identical
 * for a missing task, so an opaque id cannot probe another project. */
function taskOutOfScope(): TaskError {
  return new TaskError('TASK_NOT_FOUND', 'Task not found', 404);
}

async function assertDelegatingRun(
  tx: TransactionSql,
  args: {
    organizationId: string;
    via: Extract<StartedVia, { kind: 'agent' }>;
  },
): Promise<void> {
  const runs = await tx<
    {
      projectId: string;
      agentId: string;
      sessionId: string;
      startedBy: string;
      startedVia: string | null;
    }[]
  >`
    SELECT project_id AS "projectId", agent_id AS "agentId",
           session_id AS "sessionId", started_by AS "startedBy",
           started_via AS "startedVia"
    FROM app.project_agent_runs
    WHERE id = ${args.via.runId} AND org_id = ${args.organizationId}
      AND agent_id = ${args.via.agentId} AND status IN ('queued', 'running')
    LIMIT 1
  `;
  const run = runs[0];
  if (run === undefined) {
    throw new TaskError(
      'AGENT_START_FORBIDDEN',
      'The run asking to start an agent has ended; only a live run may put another agent to work',
      403,
    );
  }
  if (run.startedVia === 'agent') {
    throw new TaskError(
      'AGENT_START_FORBIDDEN',
      'An agent another agent started cannot put further agents to work; report what should happen next instead',
      403,
    );
  }
  if (
    await isTaskRunConfined(tx, {
      organizationId: args.organizationId,
      ...run,
    })
  ) {
    throw new TaskError(
      'AGENT_START_FORBIDDEN',
      'This run was started by a member who can work only their own task; it cannot put other agents to work',
      403,
    );
  }
}

/** The activity actor of the requester: the asking agent, or the workflow
 * sentinel for an automation step. */
function actorOf(via: StartedVia): string {
  return via.kind === 'agent' ? via.agentId : WORKFLOW_ACTOR_ID;
}

export async function startDelegatedAgentRun(
  tx: TransactionSql,
  args: DelegatedAgentStartArgs,
): Promise<DelegatedAgentStart> {
  const trigger = args.via.kind === 'agent' ? 'delegated' : 'automation';
  let task = await loadTaskOrThrow(tx, args.taskId, args.organizationId).catch(
    (error: unknown) => {
      if (error instanceof TaskError && error.code === 'TASK_NOT_FOUND') {
        throw taskOutOfScope();
      }
      throw error;
    },
  );
  if (!args.scopeProjectIds.includes(task.projectId)) throw taskOutOfScope();

  // The slot receipt comes first: a re-delivered step answers what its
  // first delivery did, even if the card or the rights moved since.
  if (args.via.kind === 'automation') {
    const receipts = await tx<{ id: string; agentId: string }[]>`
      SELECT id, agent_id AS "agentId" FROM app.project_agent_runs
      WHERE started_via_run_id = ${args.via.runId}
        AND started_via_node_id = ${args.via.nodeId}
        AND task_id = ${task.id} AND trigger = 'automation'
      LIMIT 1
    `;
    const receipt = receipts[0];
    if (receipt !== undefined) {
      return {
        outcome: 'started',
        runId: receipt.id,
        taskId: task.id,
        agentId: receipt.agentId,
        replayed: true,
      };
    }
  }

  const project = await loadProjectOrThrow(tx, task.projectId);
  if (project.archivedAt !== null) {
    throw new TaskError(
      'PROJECT_ARCHIVED',
      'The project is archived; restore it before starting agents in it',
      409,
    );
  }
  if (task.archivedAt !== null) {
    throw new TaskError(
      'TASK_ARCHIVED',
      'The task is archived; restore it before starting an agent on it',
      409,
    );
  }
  if (parseRunStarter(args.startedBy).kind === 'unknown') {
    throw new TaskError(
      'AGENT_START_FORBIDDEN',
      'This run answers to nobody who may start agents',
      403,
    );
  }
  if (
    !(await runStarterMayEditProject(tx, {
      organizationId: args.organizationId,
      projectId: task.projectId,
      startedBy: args.startedBy,
    }))
  ) {
    throw new TaskError(
      'AGENT_START_FORBIDDEN',
      parseRunStarter(args.startedBy).kind === 'trigger'
        ? 'The schedule this work began with may not start agents in this project any more: it is paused, removed, or its automation is no longer bound to the project'
        : 'The person this work answers to may no longer edit this project, so no agent can be started for them',
      403,
    );
  }
  if (args.via.kind === 'agent') {
    await assertDelegatingRun(tx, {
      organizationId: args.organizationId,
      via: args.via,
    });
  }
  await assertTaskAutomationEnabled(tx, args.organizationId);

  const agentId = args.agentId ?? task.assigneeId;
  if (agentId === undefined || agentId === null) {
    throw new TaskError(
      'TASK_NO_AGENT_ASSIGNEE',
      'The task has no agent assignee; name the agent to start',
      409,
    );
  }
  if (args.agentId === undefined && task.assigneeType !== 'agent') {
    throw new TaskError(
      'TASK_NO_AGENT_ASSIGNEE',
      'The task is assigned to someone other than an agent; name the agent to start',
      409,
    );
  }
  // One active piece of work per agent workspace: the agent row is the
  // lock two starts of the same agent queue on, so the busy probe below
  // cannot miss a run another start is minting. A write rather than a
  // SELECT FOR UPDATE, as `lockTaskRunStart` does for the task: the loser's
  // serializable snapshot is invalidated too, and its retry sees the winner.
  const agents = await tx<
    {
      id: string;
      harness: string;
      model: string;
      modelProvider: string | null;
    }[]
  >`
    UPDATE app.project_agents SET updated_at_ms = updated_at_ms
    WHERE id = ${agentId} AND org_id = ${args.organizationId}
      AND project_id = ${task.projectId}
    RETURNING id, harness, model, model_provider AS "modelProvider"
  `;
  const agent = agents[0];
  if (agent === undefined) {
    throw new TaskError(
      'AGENT_NOT_FOUND',
      'No agent with that id works in this project',
      404,
    );
  }
  if (agent.model === '') {
    throw new TaskError(
      'AGENT_MODEL_MISSING',
      'The agent has no model configured; an editor has to choose one first',
      409,
    );
  }

  // The task's own live run carries the work: a schedule's occurrence that
  // finds its role still working, or a request for work already under way.
  const live = await tx<{ id: string; agentId: string }[]>`
    SELECT id, agent_id AS "agentId" FROM app.project_agent_runs
    WHERE task_id = ${task.id} AND status IN ('queued', 'running')
    LIMIT 1
  `;
  const liveRun = live[0];
  if (liveRun !== undefined) {
    if (liveRun.agentId !== agent.id) {
      throw new TaskError(
        'TASK_HAS_LIVE_RUN',
        'Another agent is working this task; it cannot pass to a different agent until that run ends',
        409,
      );
    }
    return {
      outcome: 'already_running',
      runId: liveRun.id,
      taskId: task.id,
      agentId: agent.id,
    };
  }

  // An in-place start leaves the card where it stands, so it starts only
  // under open work. Checked before anything is assigned: a refused start
  // changes nothing on the task.
  if (args.moveToInProgress === false) {
    const pendingReviews = await tx<{ id: string }[]>`
      SELECT id FROM app.approvals
      WHERE org_id = ${args.organizationId} AND resource_type = 'task_review'
        AND resource_id = ${task.id} AND status = 'pending'
      LIMIT 1
    `;
    if (task.status === 'in_review' || pendingReviews.length > 0) {
      return { outcome: 'in_review', taskId: task.id, agentId: agent.id };
    }
    if (TERMINAL_STATUSES.has(task.status)) {
      return {
        outcome: 'closed',
        taskId: task.id,
        agentId: agent.id,
        taskStatus: task.status,
      };
    }
  }

  const busy = await tx<{ id: string; taskId: string }[]>`
    SELECT id, task_id AS "taskId" FROM app.project_agent_runs
    WHERE org_id = ${args.organizationId} AND agent_id = ${agent.id}
      AND session_id = ${standingSessionIdForProjectAgent(agent.id)}
      AND status IN ('queued', 'running') AND task_id <> ${task.id}
    ORDER BY seq DESC
    LIMIT 1
  `;
  const busyRun = busy[0];
  if (busyRun !== undefined) {
    return {
      outcome: 'agent_busy',
      runId: busyRun.id,
      busyTaskId: busyRun.taskId,
      taskId: task.id,
      agentId: agent.id,
    };
  }

  const blockers = await tx<{ id: string }[]>`
    SELECT t.id FROM app.task_dependencies d
    JOIN app.tasks t ON t.id = d.blocker_task_id
    WHERE d.blocked_task_id = ${task.id}
      AND t.status NOT IN ${tx([...TERMINAL_STATUSES])}
    ORDER BY t.id
  `;
  if (blockers.length > 0) {
    return {
      outcome: 'blocked',
      taskId: task.id,
      agentId: agent.id,
      blockedBy: blockers.map((row) => row.id),
    };
  }

  const now = Date.now();
  const recent = await tx<{ startedAt: number }[]>`
    SELECT started_at_ms::float8 AS "startedAt" FROM app.project_agent_runs
    WHERE task_id = ${task.id} AND trigger IN ('automation', 'delegated')
      AND started_at_ms > ${now - HOUR_MS}
    ORDER BY started_at_ms
  `;
  if (recent.length >= AUTOMATED_STARTS_PER_TASK_PER_HOUR) {
    // Recorded as the agent whose run was refused — the refusal banner and
    // the history read "<agent> could not start: agent runs are paused on
    // this task".
    await recordActivity(tx, {
      task,
      actorType: 'agent',
      actorId: agent.id,
      action: 'agent_run.refused',
      toValue: 'task_circuit_breaker',
    });
    return {
      outcome: 'paused',
      taskId: task.id,
      agentId: agent.id,
      retryAfter: (recent[0]?.startedAt ?? now) + HOUR_MS,
    };
  }

  if (task.assigneeType !== 'agent' || task.assigneeId !== agent.id) {
    await agentAssignTaskToAgentTrusted(tx, {
      task,
      agentId: agent.id,
      actorId: actorOf(args.via),
    });
    task = await loadTaskOrThrow(tx, task.id, args.organizationId);
  }
  const kicked = await kickAgentRun(tx, {
    organizationId: args.organizationId,
    projectId: task.projectId,
    taskId: task.id,
    agentId: agent.id,
    harness: agent.harness,
    model: agent.model,
    ...(agent.modelProvider !== null
      ? { modelProvider: agent.modelProvider }
      : {}),
    startedBy: args.startedBy,
    trigger,
    startedVia: args.via,
    ...(args.feedback !== undefined && args.feedback.trim() !== ''
      ? { feedback: args.feedback }
      : {}),
  });
  if (kicked.reused) {
    return {
      outcome: 'already_running',
      runId: kicked.runId,
      taskId: task.id,
      agentId: agent.id,
    };
  }
  if (args.moveToInProgress !== false) {
    await agentHandTaskToInProgressTrusted(tx, {
      organizationId: args.organizationId,
      taskId: task.id,
      actorId: actorOf(args.via),
    });
  }
  return {
    outcome: 'started',
    runId: kicked.runId,
    taskId: task.id,
    agentId: agent.id,
  };
}
