import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { parseRunStarter } from '../../../lib/shared/run-starter.ts';
import { loadProjectOrThrow } from '../projects/service.ts';
import { queuedOnTask } from './comments.ts';
import {
  type DelegatedAgentStart,
  startDelegatedAgentRun,
} from './delegated-start.ts';
import { TaskError } from './errors.ts';
import { requestMentionHandoffInTx } from './mention-handoff-requests.ts';
import {
  agentMayStartAgents,
  type MentionHandoffDrop,
  type MentionHandoffFacts,
  type MentionHandoffRefusal,
  nextHandoffStep,
} from './mention-handoffs.ts';
import { getPendingReviewForTask, type PendingTaskReview } from './reviews.ts';
import { runStarterMayEditProject } from './run-authority.ts';
import {
  loadTaskOrThrow,
  recordActivity,
  taskHasLiveAutomationRun,
  type TaskRow,
} from './service.ts';

/**
 * Takes up pending handoffs by mention (`mention-handoffs.ts`): each run's
 * end asks for the ones it may let start (`mention-handoff-requests.ts`),
 * and the task-agent watchdog asks for the rest (`sweepMentionHandoffs`).
 * One handoff is decided in one transaction under its task's comment queue,
 * so a comment that replaces it and a second delivery of its job queue
 * behind it; the start itself is the agent start a run makes with
 * `task_start_agent` (`startDelegatedAgentRun`), on behalf of the run that
 * wrote the comment, and refused where that start would be.
 */

interface PendingHandoff {
  id: string;
  organizationId: string;
  projectId: string;
  taskId: string;
  agentId: string;
  messageId: string;
  authorAgentId: string;
  authorRunId: string;
  approvalId: string | null;
  createdAt: number;
}

/** A start attempt's result: started, or what the handoff does instead. */
export type HandoffStartResult =
  | { kind: 'started'; runId: string }
  | { kind: 'wait' }
  | { kind: 'drop'; reason: MentionHandoffDrop }
  | { kind: 'refuse'; reason: MentionHandoffRefusal; code?: string };

/** The occupancy of a run, as the dispatch counts it: queued or running,
 * or failed with its automatic retry armed and not yet replaced. */
const OCCUPYING = `(r.status IN ('queued', 'running')
  OR (r.status = 'failed' AND r.auto_retry_armed_at_ms IS NOT NULL
    AND r.auto_retry_refused_at_ms IS NULL
    AND NOT EXISTS (SELECT 1 FROM app.project_agent_runs later
      WHERE later.task_id = r.task_id AND later.seq > r.seq)))`;

/** Decide one pending handoff: start it, wait, refuse or drop it. */
export async function processMentionHandoff(
  sql: Sql,
  args: { organizationId: string; taskId: string; handoffId: string },
): Promise<void> {
  await transactSerializable(sql, (tx) =>
    queuedOnTask(tx, args.taskId, () => decideHandoff(tx, args)),
  );
}

async function decideHandoff(
  tx: TransactionSql,
  args: { organizationId: string; taskId: string; handoffId: string },
): Promise<void> {
  const handoffs = await tx<PendingHandoff[]>`
    SELECT id, org_id AS "organizationId", project_id AS "projectId",
           task_id AS "taskId", agent_id AS "agentId", message_id AS "messageId",
           author_agent_id AS "authorAgentId", author_run_id AS "authorRunId",
           approval_id AS "approvalId", created_at_ms::float8 AS "createdAt"
    FROM app.task_mention_handoffs
    WHERE id = ${args.handoffId} AND org_id = ${args.organizationId}
      AND task_id = ${args.taskId}
  `;
  const handoff = handoffs[0];
  if (handoff === undefined) return;
  const task = await loadTaskOrThrow(tx, handoff.taskId, args.organizationId);
  const writers = await tx<
    { startedBy: string; apiKeyId: string | null; atWork: boolean }[]
  >`
    SELECT r.started_by AS "startedBy", r.api_key_id AS "apiKeyId",
           ${tx.unsafe(OCCUPYING)} AS "atWork"
    FROM app.project_agent_runs r
    WHERE r.id = ${handoff.authorRunId} AND r.org_id = ${handoff.organizationId}
  `;
  const writer = writers[0];
  if (writer === undefined) {
    // The writing run's record is gone with its task: nobody to answer to.
    await settle(tx, task, handoff, { kind: 'drop', reason: 'starter_lost' });
    return;
  }
  const comments = await tx<{ text: string | null }[]>`
    SELECT m.text FROM app.task_discussion_message_meta d
    JOIN app.messages m ON m.id = d.message_id AND m.org_id = d.org_id
    WHERE d.org_id = ${handoff.organizationId} AND d.task_id = ${task.id}
      AND d.message_id = ${handoff.messageId}
  `;
  const comment = comments[0];
  const pending = await getPendingReviewForTask(
    tx,
    handoff.organizationId,
    task.id,
  );
  const facts = await readFacts(tx, {
    handoff,
    task,
    writer,
    commentGone: comment === undefined,
    pending,
  });
  const step = nextHandoffStep(facts);
  if (step.kind === 'wait') return;
  if (step.kind === 'drop' || step.kind === 'refuse') {
    await settle(tx, task, handoff, step);
    return;
  }
  const via = {
    kind: 'agent' as const,
    runId: handoff.authorRunId,
    agentId: handoff.authorAgentId,
  };
  const common = {
    organizationId: handoff.organizationId,
    scopeProjectIds: [task.projectId],
    startedBy: writer.startedBy,
    ...(writer.apiKeyId !== null ? { apiKeyId: writer.apiKeyId } : {}),
    via,
    agentId: handoff.agentId,
    mentionHandoff: true as const,
  };
  if (step.kind === 'review') {
    // `readFacts` found the review pending, routed here and startable.
    if (
      pending?.runId === null ||
      pending?.runId === undefined ||
      pending.evidenceRevision === null
    )
      return;
    const result = await attemptStart(
      tx,
      {
        ...common,
        taskId: step.contextTaskId,
        moveToInProgress: false,
        reviewBatch: {
          operation: 'start_batch',
          requestId: handoff.id,
          contextTaskId: step.contextTaskId,
          targets: [
            {
              taskId: task.id,
              expected: {
                approvalId: pending.approvalId,
                runId: pending.runId,
                evidenceRevision: pending.evidenceRevision,
              },
            },
          ],
        },
      },
      'review',
    );
    await settle(tx, task, handoff, result, {
      contextTaskId: step.contextTaskId,
      approvalId: pending.approvalId,
    });
    return;
  }
  const result = await attemptStart(
    tx,
    {
      ...common,
      taskId: task.id,
      ...(comment?.text !== null && comment?.text !== undefined
        ? { feedback: comment.text }
        : {}),
    },
    'task',
  );
  await settle(tx, task, handoff, result);
}

/** Everything the next step depends on, read under the task's queue. */
async function readFacts(
  tx: TransactionSql,
  args: {
    handoff: PendingHandoff;
    task: TaskRow;
    writer: { startedBy: string; atWork: boolean };
    commentGone: boolean;
    pending: PendingTaskReview | null;
  },
): Promise<MentionHandoffFacts> {
  const { handoff, task } = args;
  const project = await loadProjectOrThrow(tx, task.projectId);
  const holders = await tx<{ agentId: string }[]>`
    SELECT r.agent_id AS "agentId" FROM app.project_agent_runs r
    WHERE r.task_id = ${task.id} AND ${tx.unsafe(OCCUPYING)}
    ORDER BY (r.agent_id = ${handoff.agentId}) DESC
    LIMIT 1
  `;
  const holder = holders[0];
  const agents = await tx<{ model: string }[]>`
    SELECT model FROM app.project_agents
    WHERE org_id = ${handoff.organizationId} AND project_id = ${task.projectId}
      AND id = ${handoff.agentId}
  `;
  return {
    authorAtWork: args.writer.atWork,
    commentGone: args.commentGone,
    archived: task.archivedAt !== null || project.archivedAt !== null,
    closed: task.status === 'done' || task.status === 'cancelled',
    assignedToPerson: task.assigneeType === 'user',
    authorMayStartAgents: await agentMayStartAgents(
      tx,
      task,
      handoff.authorAgentId,
    ),
    starterMayAct:
      parseRunStarter(args.writer.startedBy).kind !== 'unknown' &&
      (await runStarterMayEditProject(tx, {
        organizationId: handoff.organizationId,
        projectId: task.projectId,
        startedBy: args.writer.startedBy,
      })),
    holder:
      holder === undefined
        ? 'none'
        : holder.agentId === handoff.agentId
          ? 'named'
          : 'other',
    automationHoldsTask: await taskHasLiveAutomationRun(tx, task),
    review: await targetedReview(tx, handoff, args.pending),
    inReview: task.status === 'in_review' || args.pending !== null,
    agentAvailable: agents[0] !== undefined && agents[0].model !== '',
  };
}

/**
 * The review the handoff is to start: the newest task review routed to the
 * named agent that is the one the comment found pending, or one requested
 * since the comment (an agent hands over before it moves its card to In
 * review). Decided once it is no longer pending.
 */
async function targetedReview(
  tx: TransactionSql,
  handoff: PendingHandoff,
  pending: PendingTaskReview | null,
): Promise<MentionHandoffFacts['review']> {
  const reviews = await tx<{ id: string; status: string }[]>`
    SELECT id, status FROM app.approvals
    WHERE org_id = ${handoff.organizationId} AND resource_type = 'task_review'
      AND resource_id = ${handoff.taskId} AND wf_execution_id IS NULL
      AND metadata -> 'reviewer' ->> 'kind' = 'agent'
      AND metadata -> 'reviewer' ->> 'agentId' = ${handoff.agentId}
      AND (id = ${handoff.approvalId} OR created_at_ms >= ${handoff.createdAt})
    ORDER BY seq DESC
    LIMIT 1
  `;
  const review = reviews[0];
  if (review === undefined) {
    return handoff.approvalId === null ? { kind: 'none' } : { kind: 'decided' };
  }
  if (review.status !== 'pending') return { kind: 'decided' };
  const startable =
    pending?.approvalId === review.id &&
    pending.runId !== null &&
    pending.evidenceRevision !== null &&
    pending.agentReviewBlockedReason === null;
  return {
    kind: 'pending',
    startable,
    context: startable ? await pickReviewContext(tx, handoff) : 'none',
  };
}

/**
 * The review context the named reviewer works the review under: of its
 * enabled contexts in the task's project, those open to an in-place start
 * (not archived, not at In review, Done or Cancelled, no review of their
 * own pending), oldest first, the first that no run holds. `busy` while
 * every such context is held; `none` without one.
 */
export async function pickReviewContext(
  tx: TransactionSql,
  args: { organizationId: string; projectId: string; agentId: string },
): Promise<'none' | 'busy' | { taskId: string }> {
  const contexts = await tx<{ taskId: string; busy: boolean }[]>`
    SELECT c.task_id AS "taskId",
           EXISTS (SELECT 1 FROM app.project_agent_runs r
             WHERE r.task_id = c.task_id AND r.status IN ('queued', 'running'))
             AS busy
    FROM app.task_review_contexts c
    JOIN app.tasks t ON t.id = c.task_id AND t.org_id = c.org_id
    WHERE c.org_id = ${args.organizationId} AND c.project_id = ${args.projectId}
      AND c.reviewer_agent_id = ${args.agentId} AND c.enabled
      AND t.archived_at_ms IS NULL
      AND t.status NOT IN ('in_review', 'done', 'cancelled')
      AND NOT EXISTS (SELECT 1 FROM app.approvals a
        WHERE a.org_id = c.org_id AND a.resource_type = 'task_review'
          AND a.resource_id = c.task_id AND a.status = 'pending')
    ORDER BY c.created_at_ms, c.task_id
  `;
  if (contexts.length === 0) return 'none';
  const free = contexts.find((context) => !context.busy);
  return free === undefined ? 'busy' : { taskId: free.taskId };
}

/** Thrown out of the start's savepoint when the start did not happen, so
 * nothing it wrote stays (its own refusal activity included): the handoff
 * records its own reason. */
class StartNotTaken extends Error {
  constructor(readonly result: HandoffStartResult) {
    super('The handoff by mention started no run');
  }
}

async function attemptStart(
  tx: TransactionSql,
  args: Parameters<typeof startDelegatedAgentRun>[1],
  lane: 'task' | 'review',
): Promise<HandoffStartResult> {
  try {
    return await tx.savepoint(async (sp) => {
      const result = handoffStartResult(
        await startDelegatedAgentRun(sp, args),
        lane,
      );
      if (result.kind !== 'started') throw new StartNotTaken(result);
      return result;
    });
  } catch (error) {
    if (error instanceof StartNotTaken) return error.result;
    if (error instanceof TaskError) return handoffStartError(error.code);
    throw error;
  }
}

/** What a handoff does with the start's answer. */
export function handoffStartResult(
  start: DelegatedAgentStart,
  lane: 'task' | 'review',
): HandoffStartResult {
  switch (start.outcome) {
    case 'started':
      return { kind: 'started', runId: start.runId };
    case 'review_batch': {
      const run = start.batch.runs[0];
      return run === undefined
        ? { kind: 'refuse', reason: 'start_refused', code: 'review_batch' }
        : { kind: 'started', runId: run.runId };
    }
    case 'paused':
      return { kind: 'refuse', reason: 'task_circuit_breaker' };
    case 'blocked':
      return { kind: 'refuse', reason: 'blocked' };
    case 'already_running':
      // The named agent works the task already; a review context its run
      // holds frees up when that run ends.
      return lane === 'task'
        ? { kind: 'drop', reason: 'already_working' }
        : { kind: 'wait' };
    case 'in_review':
    case 'closed':
      // Only an in-place start answers so: the review context changed
      // under the pick, and another one may serve.
      return { kind: 'wait' };
    default:
      return { kind: 'refuse', reason: 'start_refused', code: start.outcome };
  }
}

/** What a handoff does with a start the agent start door refused. */
export function handoffStartError(code: string): HandoffStartResult {
  if (code === 'TASK_HAS_LIVE_RUN') return { kind: 'wait' };
  if (code === 'TASK_ARCHIVED' || code === 'PROJECT_ARCHIVED')
    return { kind: 'drop', reason: 'archived' };
  if (code === 'AGENT_START_FORBIDDEN')
    return { kind: 'drop', reason: 'starter_lost' };
  if (code.startsWith('TASK_AUTOMATION_'))
    return { kind: 'refuse', reason: 'automation_disabled' };
  if (code === 'AGENT_NOT_FOUND' || code === 'AGENT_MODEL_MISSING')
    return { kind: 'refuse', reason: 'agent_unavailable' };
  if (code.startsWith('TASK_REVIEW') || code.startsWith('REVIEW_'))
    return { kind: 'refuse', reason: 'review_unavailable', code };
  return { kind: 'refuse', reason: 'start_refused', code };
}

/** Record how a handoff ended and delete it; a waiting one stays. */
async function settle(
  tx: TransactionSql,
  task: TaskRow,
  handoff: PendingHandoff,
  result: HandoffStartResult,
  review?: { contextTaskId: string; approvalId: string },
): Promise<void> {
  if (result.kind === 'wait') return;
  await tx`DELETE FROM app.task_mention_handoffs WHERE id = ${handoff.id}`;
  const evidence = {
    commentId: handoff.messageId,
    fromAgentId: handoff.authorAgentId,
    fromRunId: handoff.authorRunId,
    ...review,
  };
  if (result.kind === 'started') {
    await recordActivity(tx, {
      task,
      actorType: 'agent',
      actorId: handoff.authorAgentId,
      action: 'mention_handoff.started',
      toValue: handoff.agentId,
      context: { ...evidence, runId: result.runId },
    });
    return;
  }
  if (result.kind === 'drop') {
    await recordActivity(tx, {
      task,
      actorType: 'agent',
      actorId: handoff.agentId,
      action: 'mention_handoff.dropped',
      toValue: result.reason,
      context: evidence,
    });
    return;
  }
  await recordActivity(tx, {
    task,
    actorType: 'agent',
    actorId: handoff.agentId,
    action: 'mention_handoff.refused',
    toValue: result.reason,
    context: {
      ...evidence,
      ...(result.code !== undefined ? { code: result.code } : {}),
    },
  });
}

/** How many pending handoffs one sweep asks for. */
const SWEEP_BATCH = 100;

/** How long a handoff is left to its run ends before the sweep asks. */
const SWEEP_GRACE_MS = 60_000;

/**
 * The backstop of the run ends that ask for pending handoffs (the task-agent
 * watchdog's): asks for each one whose writing run is no longer live and
 * whose task no run holds, such as one written as its run ended.
 */
export async function sweepMentionHandoffs(sql: Sql): Promise<number> {
  return sql.begin(async (tx) => {
    const ready = await tx<
      { id: string; organizationId: string; taskId: string }[]
    >`
      SELECT h.id, h.org_id AS "organizationId", h.task_id AS "taskId"
      FROM app.task_mention_handoffs h
      WHERE h.created_at_ms < ${Date.now() - SWEEP_GRACE_MS}
        AND NOT EXISTS (SELECT 1 FROM app.project_agent_runs a
          WHERE a.id = h.author_run_id AND a.status IN ('queued', 'running'))
        AND NOT EXISTS (SELECT 1 FROM app.project_agent_runs r
          WHERE r.task_id = h.task_id AND r.status IN ('queued', 'running'))
      ORDER BY h.created_at_ms
      LIMIT ${SWEEP_BATCH}
    `;
    for (const handoff of ready) {
      await requestMentionHandoffInTx(tx, {
        organizationId: handoff.organizationId,
        taskId: handoff.taskId,
        handoffId: handoff.id,
      });
    }
    return ready.length;
  });
}
