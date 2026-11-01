import type { TransactionSql } from 'postgres';

import { handoffMentionAgentIds } from '../../core/tasks/mentions.ts';
import { getPendingReviewForTask } from './reviews.ts';
import { isTaskRunConfined } from './run-authority.ts';
import { recordActivity, type TaskRow } from './service.ts';

/**
 * Handoffs by mention: a comment an agent's run writes through
 * `task_comment` that names another agent of the task's project hands the
 * task to it, the way the run could have started that agent itself with
 * `task_start_agent` [TASK-R88]. The comment is recorded as a pending
 * handoff (`app.task_mention_handoffs`) and starts nothing yet: no agent's
 * text steers a live run, and the named agent starts only once the writing
 * run has ended and no run holds the task (`mention-handoff-runner.ts`).
 *
 * Only a run that may put agents to work itself hands a task on: its agent
 * holds `task_start_agent` in the task's project, and the run is neither
 * confined to its own task nor started by another agent (one hop)
 * [TASK-R89]. A person's mention keeps its own lane
 * (`dispatchMentionedProjectAgent`), and a review's feedback hands nothing
 * on (`addTaskReviewFeedback`).
 *
 * The task's history records how each one ends: `mention_handoff.started`
 * (the asking agent acts, the named agent is the value), and
 * `mention_handoff.refused` or `mention_handoff.dropped` (the named agent
 * acts, the reason is the value).
 */

/** Why a handoff by mention starts nobody although it is still wanted. */
export type MentionHandoffRefusal =
  /** The writing agent may not start agents in the task's project. */
  | 'no_start_grant'
  /** The writing run was itself started by another agent. */
  | 'second_hop'
  /** The writing run may work only its own task. */
  | 'confined'
  /** The card waits at In review for someone else's decision. */
  | 'in_review'
  /** An automation works the task. */
  | 'automation_holds_task'
  /** The organization switched agent automation off. */
  | 'automation_disabled'
  /** The task had its automated starts for the hour. */
  | 'task_circuit_breaker'
  /** The task waits for the tasks it depends on. */
  | 'blocked'
  /** The named reviewer has no review context free to work under. */
  | 'no_review_context'
  /** The named agent is gone or has no model. */
  | 'agent_unavailable'
  /** The pending review cannot be started by an agent as it stands. */
  | 'review_unavailable'
  /** Any other refusal of the start; its code is in the activity. */
  | 'start_refused';

/** Why a pending handoff by mention is no longer wanted. */
export type MentionHandoffDrop =
  | 'closed'
  | 'archived'
  | 'assigned_to_person'
  | 'comment_deleted'
  | 'already_working'
  /** The writing agent lost `task_start_agent`. */
  | 'grant_lost'
  /** Whoever the writing run answers to may no longer act here. */
  | 'starter_lost'
  /** The review the handoff was to start was decided first. */
  | 'review_decided'
  /** A later comment named the same agent on the same task. */
  | 'superseded';

/** What a pending handoff does next, from what holds of it now. */
export type MentionHandoffStep =
  | { kind: 'wait' }
  | { kind: 'drop'; reason: MentionHandoffDrop }
  | { kind: 'refuse'; reason: MentionHandoffRefusal }
  /** Assign the named agent and start it on the task. */
  | { kind: 'start' }
  /** Start the named reviewer in place on this review context. */
  | { kind: 'review'; contextTaskId: string };

/** What the next step of a pending handoff depends on. */
export interface MentionHandoffFacts {
  /** The writing run still works, or its failure armed a retry. */
  authorAtWork: boolean;
  commentGone: boolean;
  /** The task or its project is archived. */
  archived: boolean;
  /** The card is Done or Cancelled. */
  closed: boolean;
  assignedToPerson: boolean;
  /** The writing agent still holds `task_start_agent` in the project. */
  authorMayStartAgents: boolean;
  /** Whoever the writing run answers to may still act in the project. */
  starterMayAct: boolean;
  /** Whose run holds the task now. */
  holder: 'none' | 'named' | 'other';
  automationHoldsTask: boolean;
  /** The review the handoff is to start: the one the comment found routed
   * to the named agent, or one routed to it since. */
  review:
    | { kind: 'none' }
    | { kind: 'decided' }
    | {
        kind: 'pending';
        /** It names a settled source run an agent may review. */
        startable: boolean;
        /** Where the named reviewer may work it (`pickReviewContext`). */
        context: 'none' | 'busy' | { taskId: string };
      };
  /** The card is at In review, or a review routed elsewhere is pending. */
  inReview: boolean;
  /** The named agent exists in the project and has a model. */
  agentAvailable: boolean;
}

const WAIT: MentionHandoffStep = { kind: 'wait' };

/**
 * The next step of a pending handoff [TASK-R92]. It waits while the writing
 * run works and while another run holds the task; it is dropped once the
 * task, the comment, the writer's right or the review it targets is gone;
 * it is refused while a start would be; otherwise it starts the named
 * agent, on the task or, for the review routed to it, in place on one of
 * its review contexts [TASK-R91].
 */
export function nextHandoffStep(
  facts: MentionHandoffFacts,
): MentionHandoffStep {
  if (facts.authorAtWork) return WAIT;
  if (facts.commentGone) return { kind: 'drop', reason: 'comment_deleted' };
  if (facts.archived) return { kind: 'drop', reason: 'archived' };
  if (facts.closed) return { kind: 'drop', reason: 'closed' };
  if (facts.assignedToPerson)
    return { kind: 'drop', reason: 'assigned_to_person' };
  if (!facts.authorMayStartAgents)
    return { kind: 'drop', reason: 'grant_lost' };
  if (!facts.starterMayAct) return { kind: 'drop', reason: 'starter_lost' };
  if (facts.holder === 'named')
    return { kind: 'drop', reason: 'already_working' };
  if (facts.holder === 'other') return WAIT;
  if (facts.automationHoldsTask)
    return { kind: 'refuse', reason: 'automation_holds_task' };
  if (facts.review.kind === 'decided')
    return { kind: 'drop', reason: 'review_decided' };
  if (facts.review.kind === 'pending') {
    if (!facts.review.startable)
      return { kind: 'refuse', reason: 'review_unavailable' };
    const context = facts.review.context;
    if (context === 'none')
      return { kind: 'refuse', reason: 'no_review_context' };
    if (context === 'busy') return WAIT;
    return { kind: 'review', contextTaskId: context.taskId };
  }
  if (facts.inReview) return { kind: 'refuse', reason: 'in_review' };
  if (!facts.agentAvailable)
    return { kind: 'refuse', reason: 'agent_unavailable' };
  return { kind: 'start' };
}

/** The run that wrote a comment, as the handoff reads it. */
interface WritingRun {
  id: string;
  agentId: string;
  projectId: string;
  sessionId: string;
  startedBy: string;
  startedVia: string | null;
}

/** Why the writing run may not hand a task on at all [TASK-R89]; null when
 * it may. */
async function writerRefusal(
  tx: TransactionSql,
  task: Pick<TaskRow, 'organizationId' | 'projectId'>,
  run: WritingRun,
): Promise<MentionHandoffRefusal | null> {
  if (!(await agentMayStartAgents(tx, task, run.agentId)))
    return 'no_start_grant';
  if (run.startedVia === 'agent') return 'second_hop';
  if (
    await isTaskRunConfined(tx, {
      organizationId: task.organizationId,
      ...run,
    })
  )
    return 'confined';
  return null;
}

/** Whether an agent of the task's project holds `task_start_agent`: an
 * agent of another project holds no grant here. */
export async function agentMayStartAgents(
  tx: TransactionSql,
  task: Pick<TaskRow, 'organizationId' | 'projectId'>,
  agentId: string,
): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM app.project_agents
    WHERE org_id = ${task.organizationId} AND project_id = ${task.projectId}
      AND id = ${agentId} AND 'task_start_agent' = ANY(tools)
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Record what a comment an agent's run wrote hands on, in the comment's own
 * transaction, under its task's comment queue. `from` is the session and
 * execution the `task_comment` call came from: only a live run of the
 * writing agent there counts, so a comment written any other way hands
 * nothing on. The first agent of the task's project the stored text names
 * outside quotes and code, other than the writer, is the one handed to
 * [TASK-R90]; an agent whose run holds the task is not handed to, and its
 * run is not steered. A writer that may not hand tasks on records its
 * refusal; otherwise the handoff waits for its moment, replacing an earlier
 * one to the same agent.
 */
export async function recordMentionHandoffInTx(
  tx: TransactionSql,
  args: {
    task: TaskRow;
    messageId: string;
    /** The comment as stored: resolved mentions are tokens. */
    text: string;
    authorAgentId: string;
    from: { sessionId: string; execId: string };
  },
): Promise<void> {
  const { task } = args;
  const runs = await tx<WritingRun[]>`
    SELECT id, agent_id AS "agentId", project_id AS "projectId",
           session_id AS "sessionId", started_by AS "startedBy",
           started_via AS "startedVia"
    FROM app.project_agent_runs
    WHERE org_id = ${task.organizationId} AND session_id = ${args.from.sessionId}
      AND exec_id = ${args.from.execId} AND status IN ('queued', 'running')
    ORDER BY seq DESC
    LIMIT 1
  `;
  const run = runs[0];
  if (run === undefined || run.agentId !== args.authorAgentId) return;
  const ids = handoffMentionAgentIds(args.text).filter(
    (id) => id !== run.agentId,
  );
  if (ids.length === 0) return;
  const agents = await tx<{ id: string }[]>`
    SELECT id FROM app.project_agents
    WHERE org_id = ${task.organizationId} AND project_id = ${task.projectId}
      AND id = ANY(${ids})
  `;
  const named = ids.find((id) => agents.some((agent) => agent.id === id));
  if (named === undefined) return;
  const working = await tx<{ id: string }[]>`
    SELECT id FROM app.project_agent_runs
    WHERE task_id = ${task.id} AND agent_id = ${named}
      AND status IN ('queued', 'running')
    LIMIT 1
  `;
  if (working.length > 0) return;

  const evidence = {
    commentId: args.messageId,
    fromAgentId: run.agentId,
    fromRunId: run.id,
  };
  const refusal = await writerRefusal(tx, task, run);
  if (refusal !== null) {
    await recordActivity(tx, {
      task,
      actorType: 'agent',
      actorId: named,
      action: 'mention_handoff.refused',
      toValue: refusal,
      context: evidence,
    });
    return;
  }
  const review = await getPendingReviewForTask(
    tx,
    task.organizationId,
    task.id,
  );
  const approvalId =
    review?.reviewer?.kind === 'agent' && review.reviewer.agentId === named
      ? review.approvalId
      : null;
  const replaced = await tx<
    { messageId: string; authorAgentId: string; authorRunId: string }[]
  >`
    DELETE FROM app.task_mention_handoffs
    WHERE task_id = ${task.id} AND agent_id = ${named}
    RETURNING message_id AS "messageId", author_agent_id AS "authorAgentId",
              author_run_id AS "authorRunId"
  `;
  for (const earlier of replaced) {
    await recordActivity(tx, {
      task,
      actorType: 'agent',
      actorId: named,
      action: 'mention_handoff.dropped',
      toValue: 'superseded' satisfies MentionHandoffDrop,
      context: {
        commentId: earlier.messageId,
        fromAgentId: earlier.authorAgentId,
        fromRunId: earlier.authorRunId,
        supersededBy: args.messageId,
      },
    });
  }
  await tx`
    INSERT INTO app.task_mention_handoffs (
      org_id, project_id, task_id, agent_id, message_id,
      author_agent_id, author_run_id, approval_id, created_at_ms
    ) VALUES (
      ${task.organizationId}, ${task.projectId}, ${task.id}, ${named},
      ${args.messageId}, ${run.agentId}, ${run.id}, ${approvalId}, ${Date.now()}
    )
  `;
}
