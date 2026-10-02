import type {
  TaskAgentRepairReceipt,
  TaskAgentResumeFrom,
} from '@tale/shared/schemas/task-review';
import type { TransactionSql } from 'postgres';

import { parseRunStarter } from '../../../lib/shared/run-starter.ts';
import { SANDBOX_SESSION_LIVE_STATUSES } from '../../core/sandbox/session_constants.ts';
import { standingSessionIdForProjectAgent } from '../../core/sandbox/session_naming.ts';
import { loadProjectOrThrow } from '../projects/service.ts';
import { kickAgentRun, type StartedVia } from './agent-runs.ts';
import { openTaskBlockerIds } from './dependencies.ts';
import { TaskError } from './errors.ts';
import { markAutoRetryRetired } from './kick-plan.ts';
import {
  prepareRepair,
  readRepairDecision,
  replayRepair,
  repairFeedback,
  recordRepairAdmission,
  staleRepair,
  type RepairDecision,
  type StaleRepair,
} from './review-repair.ts';
import {
  isTaskRunConfined,
  runStarterMayEditProject,
} from './run-authority.ts';
import { assertTaskAutomationEnabled, lockTaskRunStart } from './run-start.ts';
import {
  agentAssignTaskToAgentTrusted,
  agentHandTaskToInProgressTrusted,
  loadTaskOrThrow,
  recordActivity,
  TERMINAL_STATUSES,
  type TaskRow,
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
 *   under a card that waits for its reviewer, or one already Done or
 *   Cancelled: the card would go on presenting the previous work for
 *   judgment (or as finished) while new work runs under it, and the pending
 *   review would refer to superseded work. Nothing is assigned or started;
 *   the default start moves the card and withdraws the review instead;
 * - `stale_question` — a resumption (`resumeFrom`) whose question is no
 *   longer the task's open question: the task was decided (Done, Cancelled, a
 *   move), a newer run or review exists, the assignee changed (another
 *   agent, a person, nobody), or the task is being worked. Checked under the
 *   task's row lock before anything is assigned, withdrawn, moved or
 *   started, so a decision made between the requester's read and
 *   this start is never undone;
 * - `stale_repair` — a tagged settled-review repair no longer matches the
 *   rejected native decision, latest source, assignee or untouched task
 *   history. Its durable admission receipt admits at most one repair and
 *   can be replayed by a later authorized live run of the same manager;
 * - `agent_busy` — the agent is working another task in its standing
 *   workspace, which every run it is started for here shares: one active
 *   piece of work per agent workspace. The automatic retry of such a run
 *   keeps the rule under the same lock and probe ({@link lockAgentForStart},
 *   {@link findAgentBusyRun}): it waits for the workspace instead
 *   (`task.agent_retry_recheck`, bounded by `planAgentBusyWait`) and, past
 *   that wait, is refused on the task's timeline and retired for good
 *   ({@link retireBusyRetry});
 * - `blocked` — a task this one depends on is still open;
 * - `paused` — the per-task circuit breaker ({@link admitAutomatedStart}):
 *   at most {@link AUTOMATED_STARTS_PER_TASK_PER_HOUR} starts by
 *   automations and agents per task in any rolling hour, their automatic
 *   retries included, so two agents (or an agent and a schedule) cannot
 *   restart one task in a loop, and failing retries cannot stretch the
 *   budget. The refusal lands on the task's timeline (`agent_run.refused`,
 *   `task_circuit_breaker`); a person's own Start, and its retries, are
 *   never counted or refused by it.
 *
 * The slot receipt: an automation step starts a task at most once per
 * automation run (the 0139 unique index) — a step the engine delivers again
 * finds the run the first delivery started and answers it (`replayed`).
 *
 * The card: `moveToInProgress` (the default) moves it to In progress, as
 * Start agent does, withdrawing a pending review (never approving one), and
 * the completion parks it at In review for its reviewer. `false` leaves it where
 * it is — a standing task that reports on every occurrence — and the run
 * records that intent (`in_place`, 0139), so its successful completion
 * neither moves the card nor asks for a review, whatever column the card is
 * in by then; its auto-retries carry it. It starts only under open work
 * (Backlog, To do, In progress): see `in_review` / `closed` above.
 */

/** Why a run a schedule began failed without launching: the schedule was
 * paused, removed or unbound between the kick and the turn's start. */
export const SCHEDULE_REVOKED_BEFORE_LAUNCH =
  'The schedule that started this run was paused or removed, or its automation is no longer bound to the project, before the run launched — nothing ran.';

/** Starts by automations and agents one task takes in any rolling hour —
 * their automatic retries included — before the circuit breaker refuses the
 * next. */
export const AUTOMATED_STARTS_PER_TASK_PER_HOUR = 3;

const HOUR_MS = 60 * 60 * 1000;

/**
 * The per-task circuit breaker: ONE admission for every automated start of a
 * project agent — a direct one (an automation's `task.start_agent` step,
 * another agent's `task_start_agent`) and the automatic retry that continues
 * one (`task.agent_retry`: a retry inherits `started_via`, so it stays
 * automated). It admits while the task has taken fewer than
 * {@link AUTOMATED_STARTS_PER_TASK_PER_HOUR} such starts in the last hour —
 * every run row carrying `started_via`, whatever its trigger — and records a
 * refusal on the task's timeline as the refused agent (`agent_run.refused`,
 * `task_circuit_breaker`: "<agent> could not start: agent runs are paused on
 * this task"). Runs a person started carry no `started_via`, so neither they
 * nor their retries count, and neither is ever refused here.
 *
 * Transactional: it locks the task row before counting, so two admissions of
 * one task — two agents' starts, a start racing a retry — count one after the
 * other, each inside the transaction that then inserts its run.
 */
export async function admitAutomatedStart(
  tx: TransactionSql,
  args: {
    task: Pick<TaskRow, 'id' | 'organizationId' | 'projectId'>;
    agentId: string;
  },
): Promise<{ admitted: true } | { admitted: false; retryAfter: number }> {
  await tx`
    SELECT id FROM app.tasks
    WHERE id = ${args.task.id} AND org_id = ${args.task.organizationId}
    FOR UPDATE
  `;
  const now = Date.now();
  const recent = await tx<{ startedAt: number }[]>`
    SELECT started_at_ms::float8 AS "startedAt" FROM app.project_agent_runs
    WHERE task_id = ${args.task.id} AND started_via IS NOT NULL
      AND started_at_ms > ${now - HOUR_MS}
    ORDER BY started_at_ms
  `;
  if (recent.length < AUTOMATED_STARTS_PER_TASK_PER_HOUR) {
    return { admitted: true };
  }
  await recordActivity(tx, {
    task: args.task,
    actorType: 'agent',
    actorId: args.agentId,
    action: 'agent_run.refused',
    toValue: 'task_circuit_breaker',
  });
  return {
    admitted: false,
    retryAfter: (recent[0]?.startedAt ?? now) + HOUR_MS,
  };
}

/** The agent row as a start locks it: what the kick needs to run it. */
export interface LockedAgent {
  id: string;
  projectId: string;
  harness: string;
  model: string;
  modelProvider: string | null;
}

/**
 * Take the agent row that two starts of one agent queue on, so the busy
 * probe after it ({@link findAgentBusyRun}) cannot miss a run another start
 * is minting. A write rather than a SELECT FOR UPDATE, as `lockTaskRunStart`
 * does for the task: an overlapping SERIALIZABLE snapshot is invalidated
 * too, and its retry sees the winner. Every start that locks both takes the
 * agent first, then the task — the delegated start and the automatic retry
 * alike; never the task first. `projectId` confines it to one project's
 * agents. Null when no such agent exists (nothing is locked then).
 */
export async function lockAgentForStart(
  tx: TransactionSql,
  args: { organizationId: string; agentId: string; projectId?: string },
): Promise<LockedAgent | null> {
  const agents = await tx<LockedAgent[]>`
    UPDATE app.project_agents SET updated_at_ms = updated_at_ms
    WHERE id = ${args.agentId} AND org_id = ${args.organizationId}
      AND (${args.projectId ?? null}::text IS NULL
           OR project_id = ${args.projectId ?? null})
    RETURNING id, project_id AS "projectId", harness, model,
              model_provider AS "modelProvider"
  `;
  return agents[0] ?? null;
}

/**
 * The agent's live run on another task in `sessionId` — the workspace a new
 * run of it would share — or null when that workspace is free. Judge it
 * holding the agent row ({@link lockAgentForStart}). Only this
 * organization's runs of this agent in that workspace count: its run in
 * another workspace (a member's own), or another agent's, never makes it
 * busy there.
 */
export async function findAgentBusyRun(
  tx: TransactionSql,
  args: {
    organizationId: string;
    agentId: string;
    sessionId: string;
    taskId: string;
  },
): Promise<{ id: string; taskId: string } | null> {
  const busy = await tx<{ id: string; taskId: string }[]>`
    SELECT id, task_id AS "taskId" FROM app.project_agent_runs
    WHERE org_id = ${args.organizationId} AND agent_id = ${args.agentId}
      AND session_id = ${args.sessionId}
      AND status IN ('queued', 'running') AND task_id <> ${args.taskId}
    ORDER BY seq DESC
    LIMIT 1
  `;
  return busy[0] ?? null;
}

/**
 * Retire the automatic retry of one failed run for good — it waited for its
 * busy agent as long as it may (`planAgentBusyWait`) — and say so on the
 * task's timeline as the refused agent (`agent_run.refused`, `agent_busy`:
 * "<agent> could not start: agent is working on another task"), the circuit
 * breaker's convention. The mark sits on the failed run
 * (`auto_retry_refused_at_ms`, migration 0141): every later delivery of
 * that retry — the arm, a check queued before this one, this very job
 * again, whether the agent is busy or free by then — stands down on it
 * under the same locks, so the refusal is final. Only the call that sets
 * it writes the timeline row. Nothing is queued behind it: whoever manages
 * the task decides again, and a newer run is theirs to start.
 */
export async function retireBusyRetry(
  tx: TransactionSql,
  args: {
    task: Pick<TaskRow, 'id' | 'organizationId' | 'projectId'>;
    agentId: string;
    failedRunId: string;
  },
): Promise<boolean> {
  const retired = await markAutoRetryRetired(tx, {
    organizationId: args.task.organizationId,
    taskId: args.task.id,
    failedRunId: args.failedRunId,
  });
  if (!retired) return false;
  await recordActivity(tx, {
    task: args.task,
    actorType: 'agent',
    actorId: args.agentId,
    action: 'agent_run.refused',
    toValue: 'agent_busy',
  });
  return true;
}

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
  /**
   * Resume the agent with the answer to the question it asked: the run that
   * asked and the review it is waiting at. The start happens only while that
   * is still the task's open question — that run the task's newest and
   * ended, that review pending and bound to it, the card at In review, the
   * run's agent still the assignee, no live work — and otherwise answers
   * `stale_question` and changes nothing. Without `agentId` it resumes that
   * run's agent, never whoever holds the task now. A deliberate start leaves
   * it out. The tagged `review_repair` form instead consumes one genuine
   * native changes-requested decision under its own guard. It derives the
   * implementer and feedback, preserves intervening decisions, and records
   * a replayable admission without modifying the rejected decision.
   */
  resumeFrom?: TaskAgentResumeFrom;
}

/** Why a resumption's question is no longer the task's open question. */
export type StaleQuestionCause =
  | 'task_moved'
  | 'run_superseded'
  | 'review_changed'
  | 'assignee_changed';

export type DelegatedAgentStart =
  | StaleRepair
  | {
      outcome: 'started';
      runId: string;
      taskId: string;
      agentId: string;
      /** The step's first delivery started this run; this one found it. */
      replayed?: true;
      /** Durable source/manager binding for a guarded repair admission. */
      repairReceipt?: TaskAgentRepairReceipt;
    }
  | {
      outcome: 'already_running';
      runId: string;
      taskId: string;
      agentId: string;
    }
  | {
      /** A resumption whose question is no longer the open one. */
      outcome: 'stale_question';
      taskId: string;
      /** The agent it would have resumed; null when no agent was named and
       * the run it names is not this task's. */
      agentId: string | null;
      staleBecause: StaleQuestionCause;
    }
  | {
      /** An in-place start refused: a review is pending. */
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
    requireCurrentGrant?: boolean;
  },
): Promise<void> {
  const runs = await tx<
    {
      projectId: string;
      agentId: string;
      sessionId: string;
      startedBy: string;
      startedVia: string | null;
      repairAllowed: boolean;
    }[]
  >`
    SELECT r.project_id AS "projectId", r.agent_id AS "agentId",
           r.session_id AS "sessionId", r.started_by AS "startedBy",
           r.started_via AS "startedVia",
           (${args.requireCurrentGrant !== true} OR (
             EXISTS (SELECT 1 FROM app.project_agents a
               WHERE a.org_id = r.org_id AND a.project_id = r.project_id AND a.id = r.agent_id
                 AND 'task_start_agent' = ANY(a.tools))
             AND EXISTS (SELECT 1 FROM app.sandbox_sessions s
               WHERE s.org_id = r.org_id AND s.session_id = r.session_id
                 AND s.owner_type = 'project_agent' AND s.owner_id = r.agent_id
                 AND s.status IN ${tx([...SANDBOX_SESSION_LIVE_STATUSES])}
                 AND s.expires_at_ms > ${Date.now()})
           )) AS "repairAllowed"
    FROM app.project_agent_runs r
    WHERE r.id = ${args.via.runId} AND r.org_id = ${args.organizationId}
      AND r.agent_id = ${args.via.agentId} AND r.status IN ('queued', 'running')
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
  if (args.requireCurrentGrant === true && !run.repairAllowed) {
    throw new TaskError(
      'AGENT_START_FORBIDDEN',
      'This live manager no longer has the task delegation permission',
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

/** The agent of one of the task's runs; null when the run is not the
 * task's. */
async function agentOfTaskRun(
  tx: TransactionSql,
  args: { organizationId: string; taskId: string; runId: string },
): Promise<string | null> {
  const rows = await tx<{ agentId: string }[]>`
    SELECT agent_id AS "agentId" FROM app.project_agent_runs
    WHERE id = ${args.runId} AND task_id = ${args.taskId}
      AND org_id = ${args.organizationId}
  `;
  return rows[0]?.agentId ?? null;
}

/**
 * The resumption's precondition, judged on the task row it locks: whether
 * the question the requester answered is still the task's open question.
 * `null` when it is; otherwise the first cause that says why not. Reads
 * only — the caller refuses before it writes anything.
 */
async function staleQuestionCause(
  tx: TransactionSql,
  args: {
    organizationId: string;
    taskId: string;
    /** The agent the resumption would start; null when there is none. */
    agentId: string | null;
    resumeFrom: { runId: string; approvalId: string };
  },
): Promise<StaleQuestionCause | null> {
  const tasks = await tx<
    {
      status: string;
      assigneeType: string | null;
      assigneeId: string | null;
    }[]
  >`
    SELECT status, assignee_type AS "assigneeType",
           assignee_id AS "assigneeId"
    FROM app.tasks
    WHERE id = ${args.taskId} AND org_id = ${args.organizationId}
    FOR UPDATE
  `;
  const card = tasks[0];
  if (card === undefined || card.status !== 'in_review') return 'task_moved';
  const newest = await tx<{ id: string; status: string; agentId: string }[]>`
    SELECT id, status, agent_id AS "agentId" FROM app.project_agent_runs
    WHERE task_id = ${args.taskId} AND org_id = ${args.organizationId}
    ORDER BY seq DESC
    LIMIT 1
  `;
  const source = newest[0];
  if (
    source === undefined ||
    source.id !== args.resumeFrom.runId ||
    !['settled', 'failed', 'cancelled'].includes(source.status)
  ) {
    return 'run_superseded';
  }
  const reviews = await tx<{ id: string; runId: string | null }[]>`
    SELECT id, metadata ->> 'runId' AS "runId" FROM app.approvals
    WHERE org_id = ${args.organizationId} AND resource_type = 'task_review'
      AND resource_id = ${args.taskId} AND status = 'pending'
      AND wf_execution_id IS NULL
    ORDER BY seq DESC
  `;
  if (
    reviews.length !== 1 ||
    reviews[0]?.id !== args.resumeFrom.approvalId ||
    reviews[0].runId !== source.id
  ) {
    return 'review_changed';
  }
  if (
    card.assigneeType !== 'agent' ||
    card.assigneeId !== source.agentId ||
    args.agentId !== source.agentId
  ) {
    return 'assignee_changed';
  }
  return null;
}

export async function startDelegatedAgentRun(
  tx: TransactionSql,
  args: DelegatedAgentStartArgs,
): Promise<DelegatedAgentStart> {
  const repairFrom =
    args.resumeFrom !== undefined && 'kind' in args.resumeFrom
      ? args.resumeFrom
      : undefined;
  const questionFrom =
    args.resumeFrom !== undefined && !('kind' in args.resumeFrom)
      ? args.resumeFrom
      : undefined;
  if (
    repairFrom !== undefined &&
    (args.via.kind !== 'agent' || args.moveToInProgress === false)
  ) {
    throw new TaskError(
      'AGENT_START_FORBIDDEN',
      'A review repair needs a live manager and the ordinary task lifecycle',
      403,
    );
  }
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
      requireCurrentGrant: repairFrom !== undefined,
    });
  }
  await assertTaskAutomationEnabled(tx, args.organizationId);

  if (repairFrom !== undefined && args.via.kind === 'agent') {
    const record = await readRepairDecision(tx, task, repairFrom);
    if ('outcome' in record) return record;
    const replay = await replayRepair(
      tx,
      task,
      record,
      args.via.agentId,
      args.agentId,
    );
    if (replay !== null) return replay;
  }
  let preparedRepair: RepairDecision | undefined;
  let agentId = args.agentId ?? task.assigneeId;
  if (args.agentId === undefined && questionFrom !== undefined) {
    // A resumption resumes the agent that asked — its run's own agent, never
    // whoever holds the task now: a task handed to a person, unassigned or
    // passed to another agent since the requester's read is the question's
    // guard to judge (`assignee_changed`), like any other change.
    agentId = await agentOfTaskRun(tx, {
      organizationId: args.organizationId,
      taskId: task.id,
      runId: questionFrom.runId,
    });
  } else if (repairFrom === undefined && agentId === null) {
    throw new TaskError(
      'TASK_NO_AGENT_ASSIGNEE',
      'The task has no agent assignee; name the agent to start',
      409,
    );
  } else if (
    repairFrom === undefined &&
    args.agentId === undefined &&
    task.assigneeType !== 'agent'
  ) {
    throw new TaskError(
      'TASK_NO_AGENT_ASSIGNEE',
      'The task is assigned to someone other than an agent; name the agent to start',
      409,
    );
  }
  if (repairFrom !== undefined) {
    agentId = await agentOfTaskRun(tx, {
      organizationId: args.organizationId,
      taskId: task.id,
      runId: repairFrom.runId,
    });
    if (agentId === null) return staleRepair(task.id, 'source_unavailable');
    if (args.agentId !== undefined && args.agentId !== agentId)
      return staleRepair(task.id, 'assignee_changed', agentId);
  }
  // One active piece of work per agent workspace: the agent row is the
  // lock two starts of the same agent queue on (`lockAgentForStart`), taken
  // before any task row.
  const agent =
    agentId === null
      ? null
      : await lockAgentForStart(tx, {
          organizationId: args.organizationId,
          agentId,
          projectId: task.projectId,
        });
  if (agent === null) {
    if (repairFrom !== undefined)
      return staleRepair(task.id, 'source_unavailable', agentId);
    if (args.agentId === undefined && questionFrom !== undefined) {
      // Nobody to resume: the run named is not this task's, or its agent is
      // gone (deleting an agent unassigns its tasks). Not the open question
      // either way; the guard, under the task's row lock, says what changed.
      return {
        outcome: 'stale_question',
        taskId: task.id,
        agentId,
        staleBecause:
          (await staleQuestionCause(tx, {
            organizationId: args.organizationId,
            taskId: task.id,
            agentId: null,
            resumeFrom: questionFrom,
          })) ?? 'assignee_changed',
      };
    }
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

  // A resumption checks, under the task's row lock and before anything is
  // written, that it still answers the task's open question.
  if (questionFrom !== undefined) {
    const cause = await staleQuestionCause(tx, {
      organizationId: args.organizationId,
      taskId: task.id,
      agentId: agent.id,
      resumeFrom: questionFrom,
    });
    if (cause !== null) {
      return {
        outcome: 'stale_question',
        taskId: task.id,
        agentId: agent.id,
        staleBecause: cause,
      };
    }
  }

  if (repairFrom !== undefined && args.via.kind === 'agent') {
    await lockTaskRunStart(tx, args.organizationId, task.id);
    task = await loadTaskOrThrow(tx, task.id, args.organizationId);
    const repair = await prepareRepair(
      tx,
      task,
      repairFrom,
      agent.id,
      args.via.agentId,
    );
    if ('outcome' in repair) return repair;
    preparedRepair = repair;
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

  const busyRun = await findAgentBusyRun(tx, {
    organizationId: args.organizationId,
    agentId: agent.id,
    sessionId: standingSessionIdForProjectAgent(agent.id),
    taskId: task.id,
  });
  if (busyRun !== null) {
    return {
      outcome: 'agent_busy',
      runId: busyRun.id,
      busyTaskId: busyRun.taskId,
      taskId: task.id,
      agentId: agent.id,
    };
  }

  const blockers = await openTaskBlockerIds(tx, task.id);
  if (blockers.length > 0) {
    return {
      outcome: 'blocked',
      taskId: task.id,
      agentId: agent.id,
      blockedBy: blockers,
    };
  }

  const budget = await admitAutomatedStart(tx, { task, agentId: agent.id });
  if (!budget.admitted) {
    return {
      outcome: 'paused',
      taskId: task.id,
      agentId: agent.id,
      retryAfter: budget.retryAfter,
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
    inPlace: args.moveToInProgress === false,
    ...(preparedRepair !== undefined
      ? { feedback: repairFeedback(preparedRepair, args.feedback) }
      : args.feedback !== undefined && args.feedback.trim() !== ''
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
  const repairReceipt =
    preparedRepair !== undefined && args.via.kind === 'agent'
      ? await recordRepairAdmission(tx, task, preparedRepair, {
          runId: kicked.runId,
          implementationAgentId: agent.id,
          managerAgentId: args.via.agentId,
          issuerRunId: args.via.runId,
        })
      : undefined;
  return {
    outcome: 'started',
    runId: kicked.runId,
    taskId: task.id,
    agentId: agent.id,
    ...(repairReceipt !== undefined ? { repairReceipt } : {}),
  };
}
