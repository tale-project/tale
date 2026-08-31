import type { Sql, TransactionSql } from 'postgres';

import { TASK_AUDIT_ACTIONS } from '../../../convex/tasks/audit_actions.ts';
import { parseTaskSubjectContract } from '../../../lib/shared/schemas/task_contract.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { deployedVersion, versionRow } from '../automations/store.ts';
import { resolveSurfaceMentions } from '../collab/mention-directory.ts';
import { notifyTaskComment } from '../collab/service.ts';
import { emitEvent } from '../events/emit.ts';
import {
  loadProjectOrThrow,
  type ProjectAuthContext,
  type ProjectRow,
} from '../projects/service.ts';
import {
  createThread,
  deleteMessage,
  listThreadMessages,
  saveMessage,
  updateMessageText,
} from '../threads/store.ts';
import { kickAgentRun } from './agent-runs.ts';
import {
  assertTaskReadable,
  assertTaskWritable,
  assignTask,
  handTaskToInProgressForKick,
  loadTaskOrThrow,
  TaskError,
  taskHasLiveAutomationRun,
  type TaskRow,
} from './service.ts';

/**
 * Task discussion comments on the 0.5 message store: comments are messages
 * in the task's `task_discussion` thread with a lockstep meta row (author,
 * mentions, editedAt, locale snapshots) — the 0.4 unified-surface design.
 *
 * The mention directory (`collab/mention-directory.ts`) resolves `@handle`
 * against the people who can open the task plus its agents and deployed
 * automations; the resolved list drives the notification fan-out
 * (`notifyTaskComment`) and rides the meta row, while tokens that matched
 * nobody go back to the composer so the author is told rather than
 * silently ignored.
 *
 * Ledger: the @automation RUN TRIGGER and steering a mention into a live
 * agent run stay with the automations/agents lanes.
 */

export const TASK_COMMENT_MAX = 10_000;

interface CommentAuthor {
  actorType: 'user' | 'agent';
  actorId: string;
}

async function ensureTaskDiscussionThread(
  tx: TransactionSql,
  task: TaskRow,
): Promise<string> {
  if (task.discussionThreadId) {
    return task.discussionThreadId;
  }
  const threadId = await createThread(tx, {
    organizationId: task.organizationId,
    kind: 'task_discussion',
    title: task.title,
  });
  await tx`
    UPDATE app.tasks SET discussion_thread_id = ${threadId}
    WHERE id = ${task.id} AND discussion_thread_id IS NULL
  `;
  // A concurrent first-commenter may have won; read back the winner.
  const rows = await tx<{ discussionThreadId: string | null }[]>`
    SELECT discussion_thread_id AS "discussionThreadId" FROM app.tasks
    WHERE id = ${task.id}
  `;
  return rows[0]?.discussionThreadId ?? threadId;
}

/** Append one comment (message + lockstep meta + count + activity + audit). */
export async function addTaskComment(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: { taskId: string; body: string; author?: CommentAuthor },
): Promise<{
  messageId: string;
  threadId: string;
  unresolvedMentionTokens: string[];
}> {
  const task = await loadTaskOrThrow(tx, args.taskId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  // Commenting is READ-level (0.4 `addTaskComment*`): anyone who can see
  // the task may join its discussion; edit/delete stay write-gated below.
  assertTaskReadable(project, auth);
  const body = args.body.trim();
  if (body.length === 0 || body.length > TASK_COMMENT_MAX) {
    throw new TaskError('TASK_COMMENT_INVALID', 'Invalid comment body');
  }
  const author: CommentAuthor = args.author ?? {
    actorType: 'user',
    actorId: auth.userId,
  };

  const threadId = await ensureTaskDiscussionThread(tx, task);
  // Who this comment names. The directory is project-scoped, so only people
  // who can actually open the task are mentionable, and an unclaimed token
  // on a permissive project reads as an agent handle.
  const resolved = await resolveSurfaceMentions(tx, {
    organizationId: auth.organizationId,
    body,
    projectId: task.projectId,
  });
  const mentions = resolved.mentions;
  const { messageId } = await saveMessage(tx, {
    threadId,
    organizationId: auth.organizationId,
    role: author.actorType === 'user' ? 'user' : 'assistant',
    text: body,
    authorId: author.actorId,
  });
  await tx`
    INSERT INTO app.task_discussion_message_meta (
      message_id, org_id, thread_id, task_id, author_type, author_id,
      mentions, created_at_ms
    ) VALUES (
      ${messageId}, ${auth.organizationId}, ${threadId}, ${args.taskId},
      ${author.actorType}, ${author.actorId},
      ${mentions.length > 0 ? tx.json(toJson(mentions)) : null}, ${Date.now()}
    )
  `;
  await tx`
    UPDATE app.tasks SET
      comment_count = comment_count + 1, updated_at_ms = ${Date.now()}
    WHERE id = ${args.taskId}
  `;
  // @-ing the automation that OWNS this task starts its task workflow — the
  // counterpart of the agent lane's steer. Runs before the steer check so a
  // task can only ever have one engine start per comment.
  const automationStarted = await maybeTriggerOwningAutomation(tx, {
    auth,
    task,
    mentions,
  });
  // A comment that @-mentions one of the project's agent INSTANCES puts it
  // to work: steering its RUNNING turn, or — when the task is idle —
  // (re)assigning the task to it and kicking a fresh 'mention' run with
  // this comment as feedback (the 0.4 wire). Runs after the automation
  // check so a task can only ever have one engine start per comment.
  if (!automationStarted) {
    await dispatchMentionedProjectAgent(tx, {
      auth,
      task,
      project,
      mentions,
      authorType: author.actorType,
      authorId: author.actorId,
      feedback: body,
    });
  }
  await notifyTaskComment(tx, {
    task,
    commentId: messageId,
    mentions,
    actorType: author.actorType === 'user' ? 'user' : 'agent',
    actorId: author.actorId,
  });
  await tx`
    INSERT INTO app.task_activity (
      org_id, task_id, project_id, actor_type, actor_id, action, created_at_ms
    ) VALUES (
      ${auth.organizationId}, ${args.taskId}, ${task.projectId},
      ${author.actorType}, ${author.actorId}, 'comment.added', ${Date.now()}
    )
  `;
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: author.actorId,
    ...(auth.email !== undefined && author.actorType === 'user'
      ? { actorEmail: auth.email }
      : {}),
    actorType: author.actorType === 'user' ? 'user' : 'system',
    action: TASK_AUDIT_ACTIONS.commentCreated,
    category: 'data',
    resourceType: 'task_comment',
    resourceId: messageId,
    resourceName: task.title,
    metadata: { taskId: args.taskId },
    status: 'success',
  });
  await emitEvent(tx, {
    organizationId: auth.organizationId,
    eventType: 'comment.created',
    eventData: {
      comment: {
        body,
        projectId: task.projectId,
        taskId: args.taskId,
        mentions,
      },
    },
  });
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'task',
    entityId: args.taskId,
  });
  // Tokens that matched nobody ride back so the composer can tell the
  // author "@nobody did not match anyone" instead of silently dropping it.
  return {
    messageId,
    threadId,
    unresolvedMentionTokens: resolved.unresolvedMentionTokens,
  };
}

export interface TaskCommentItem {
  messageId: string;
  authorType: string;
  authorId: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
  mentions: { type: string; id: string }[] | null;
  bodyByLocale: Record<string, string> | null;
}

/** Ordered comment feed (message text joined with the lockstep meta). */
export async function listTaskComments(
  sql: Sql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<TaskCommentItem[]> {
  const task = await loadTaskOrThrow(sql, taskId);
  const project = await loadProjectOrThrow(sql, task.projectId);
  assertTaskReadable(project, auth);
  if (!task.discussionThreadId) {
    return [];
  }
  const messages = await listThreadMessages(sql, task.discussionThreadId);
  const meta = await sql<
    {
      messageId: string;
      authorType: string;
      authorId: string;
      editedAt: number | null;
      mentions: { type: string; id: string }[] | null;
      bodyByLocale: Record<string, string> | null;
    }[]
  >`
    SELECT message_id AS "messageId", author_type AS "authorType",
           author_id AS "authorId", edited_at_ms::float8 AS "editedAt",
           mentions, body_by_locale AS "bodyByLocale"
    FROM app.task_discussion_message_meta
    WHERE task_id = ${taskId}
  `;
  const metaById = new Map(meta.map((row) => [row.messageId, row]));
  return messages.flatMap((message) => {
    const m = metaById.get(message.id);
    if (!m) {
      return [];
    }
    return [
      {
        messageId: message.id,
        authorType: m.authorType,
        authorId: m.authorId,
        body: message.text ?? '',
        createdAt: message.createdAt,
        editedAt: m.editedAt,
        mentions: m.mentions,
        bodyByLocale: m.bodyByLocale,
      },
    ];
  });
}

async function loadCommentMeta(
  tx: TransactionSql | Sql,
  messageId: string,
): Promise<{ taskId: string; authorType: string; authorId: string }> {
  const rows = await tx<
    { taskId: string; authorType: string; authorId: string }[]
  >`
    SELECT task_id AS "taskId", author_type AS "authorType",
           author_id AS "authorId"
    FROM app.task_discussion_message_meta WHERE message_id = ${messageId}
  `;
  const meta = rows[0];
  if (!meta) {
    throw new TaskError('TASK_COMMENT_NOT_FOUND', 'Comment not found', 404);
  }
  return meta;
}

function assertCommentOwnerOrAdmin(
  auth: ProjectAuthContext,
  meta: { authorType: string; authorId: string },
): void {
  const isOwn = meta.authorType === 'user' && meta.authorId === auth.userId;
  const isAdmin = auth.role === 'owner' || auth.role === 'admin';
  if (!isOwn && !isAdmin) {
    throw new TaskError(
      'TASK_COMMENT_FORBIDDEN',
      'Only the author or an admin may modify a comment',
      403,
    );
  }
}

export async function editTaskComment(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: { messageId: string; body: string },
): Promise<void> {
  const meta = await loadCommentMeta(tx, args.messageId);
  const task = await loadTaskOrThrow(tx, meta.taskId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  assertTaskWritable(project, auth);
  assertCommentOwnerOrAdmin(auth, meta);
  const body = args.body.trim();
  if (body.length === 0 || body.length > TASK_COMMENT_MAX) {
    throw new TaskError('TASK_COMMENT_INVALID', 'Invalid comment body');
  }
  await updateMessageText(tx, args.messageId, body);
  await tx`
    UPDATE app.task_discussion_message_meta
    SET edited_at_ms = ${Date.now()}
    WHERE message_id = ${args.messageId}
  `;
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
    actorType: 'user',
    action: TASK_AUDIT_ACTIONS.commentUpdated,
    category: 'data',
    resourceType: 'task_comment',
    resourceId: args.messageId,
    resourceName: task.title,
    metadata: { taskId: meta.taskId },
    status: 'success',
  });
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'task',
    entityId: meta.taskId,
  });
}

export async function deleteTaskComment(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  messageId: string,
): Promise<void> {
  const meta = await loadCommentMeta(tx, messageId);
  const task = await loadTaskOrThrow(tx, meta.taskId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  assertTaskWritable(project, auth);
  assertCommentOwnerOrAdmin(auth, meta);
  // Meta dies by FK when the message row goes.
  await deleteMessage(tx, messageId);
  await tx`
    UPDATE app.tasks SET
      comment_count = greatest(comment_count - 1, 0),
      updated_at_ms = ${Date.now()}
    WHERE id = ${meta.taskId}
  `;
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
    actorType: 'user',
    action: TASK_AUDIT_ACTIONS.commentDeleted,
    category: 'data',
    resourceType: 'task_comment',
    resourceId: messageId,
    resourceName: task.title,
    metadata: { taskId: meta.taskId },
    status: 'success',
  });
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'task',
    entityId: meta.taskId,
  });
}

/**
 * The comment-@mention work dispatcher for the project's agent INSTANCES —
 * the 0.4 `triggerMentionedProjectAgent` wire. The FIRST mentioned instance
 * belonging to THIS project picks the lane:
 *
 * - the task's live run is RUNNING and its agent is mentioned → STEER the
 *   live turn (the steer host injects the comment over the harness's
 *   held-open stdin, or restarts the exec around it);
 * - the live run is QUEUED → nothing: its start reads the brief AFTER this
 *   comment posted;
 * - another engine holds the task (a different instance's live run, a live
 *   automation run) → nothing: a mention adds work, never preempts it, and
 *   it never reassigns under a live run;
 * - the task is idle → (re)assign it to the instance when it isn't the
 *   assignee yet (`assignTask` — the picker's own choreography) and kick a
 *   fresh 'mention' run carrying the comment as feedback; the kick moves
 *   the card to In progress.
 *
 * Every refusal is quiet — the comment has already posted and notified. The
 * gate is WRITE access: commenting is read-level, but assigning and running
 * are edits, so a read-only member's `@` stays a plain mention. Only a
 * HUMAN's comment dispatches — an agent's own comment naming itself would
 * loop. A roster-slug mention that matches no instance row belongs to the
 * automation lane, never this one.
 */
async function dispatchMentionedProjectAgent(
  tx: TransactionSql,
  args: {
    auth: ProjectAuthContext;
    task: TaskRow;
    project: ProjectRow;
    mentions: { type: string; id: string }[];
    authorType: string;
    authorId: string;
    feedback: string;
  },
): Promise<void> {
  if (args.authorType !== 'user') return;
  const mentionedAgentIds = new Set(
    args.mentions
      .filter((mention) => mention.type === 'agent')
      .map((mention) => mention.id),
  );
  if (mentionedAgentIds.size === 0) return;
  if (args.task.archivedAt !== null) return;
  try {
    assertTaskWritable(args.project, args.auth);
  } catch {
    console.warn(
      `[tasks] agent mention on ${args.task.id} stays a plain mention (author lacks write access)`,
    );
    return;
  }

  const runs = await tx<
    {
      id: string;
      agentId: string;
      status: string;
      execId: string;
      sessionId: string;
      harness: string;
      model: string;
      modelProvider: string | null;
      deadlineAt: number;
    }[]
  >`
    SELECT id, agent_id AS "agentId", status, exec_id AS "execId",
           session_id AS "sessionId", harness, model,
           model_provider AS "modelProvider",
           deadline_at_ms::float8 AS "deadlineAt"
    FROM app.project_agent_runs
    WHERE task_id = ${args.task.id} AND org_id = ${args.auth.organizationId}
      AND status IN ('queued', 'running')
    LIMIT 1
  `;
  const run = runs[0];
  if (run !== undefined) {
    // A queued run needs nothing (its start reads the brief after this
    // comment posted); a live run of an UNMENTIONED instance is never
    // preempted or reassigned over.
    if (run.status !== 'running' || !mentionedAgentIds.has(run.agentId)) {
      return;
    }
    const agents = await tx<
      {
        instructions: string | null;
        skills: string[];
        connectors: string[];
        tools: string[];
        secrets: string[];
      }[]
    >`
      SELECT instructions, skills, connectors, tools, secrets
      FROM app.project_agents WHERE id = ${run.agentId} LIMIT 1
    `;
    const agent = agents[0];
    if (agent === undefined) return;

    const authors = await tx<{ name: string | null; email: string | null }[]>`
      SELECT "name", "email" FROM "user" WHERE "id" = ${args.authorId} LIMIT 1
    `;
    const author =
      (authors[0]?.name ?? '').trim() ||
      (authors[0]?.email ?? '').trim() ||
      'a teammate';

    await addJobInTx(tx, 'task.agent_steer', {
      organizationId: args.auth.organizationId,
      runId: run.id,
      taskId: args.task.id,
      agentId: run.agentId,
      execId: run.execId,
      sessionId: run.sessionId,
      harness: run.harness,
      deadlineAt: run.deadlineAt,
      model: run.model,
      ...(run.modelProvider !== null
        ? { modelProvider: run.modelProvider }
        : {}),
      ...(agent.instructions !== null
        ? { instructions: agent.instructions }
        : {}),
      skills: agent.skills,
      connectors: agent.connectors,
      tools: agent.tools,
      secrets: agent.secrets,
      feedback: args.feedback,
      author,
      authorId: args.authorId,
      attempt: 0,
    });
    return;
  }

  // Idle lane: resolve the FIRST mentioned id that is an instance OF THIS
  // project (mention order is appearance order — the 0.4 rule).
  let instance:
    | {
        id: string;
        harness: string;
        model: string;
        modelProvider: string | null;
      }
    | undefined;
  for (const mention of args.mentions) {
    if (mention.type !== 'agent') continue;
    const candidates = await tx<
      {
        id: string;
        harness: string;
        model: string;
        modelProvider: string | null;
      }[]
    >`
      SELECT id, harness, model, model_provider AS "modelProvider"
      FROM app.project_agents
      WHERE id = ${mention.id} AND project_id = ${args.task.projectId}
        AND org_id = ${args.auth.organizationId}
      LIMIT 1
    `;
    if (candidates[0] !== undefined) {
      instance = candidates[0];
      break;
    }
  }
  if (instance === undefined) return;
  // An automation-driven task keeps its automation — one engine per task.
  if (await taskHasLiveAutomationRun(tx, args.task)) return;
  if (instance.model === '') {
    console.warn(
      `[tasks] mention kick for agent ${instance.id} refused: agent_model_missing`,
    );
    return;
  }
  if (
    args.task.assigneeType !== 'agent' ||
    args.task.assigneeId !== instance.id
  ) {
    // (Re)assign exactly like the picker — activity, audit, notify.
    await assignTask(tx, args.auth, {
      taskId: args.task.id,
      assigneeType: 'agent',
      assigneeId: instance.id,
    });
  }
  const kicked = await kickAgentRun(tx, {
    organizationId: args.auth.organizationId,
    projectId: args.task.projectId,
    taskId: args.task.id,
    agentId: instance.id,
    harness: instance.harness,
    model: instance.model,
    ...(instance.modelProvider !== null
      ? { modelProvider: instance.modelProvider }
      : {}),
    startedBy: args.auth.userId,
    trigger: 'mention',
    feedback: args.feedback,
  });
  if (kicked.reused) {
    // A racing kick landed between this transaction's live-run probe and
    // here — the comment rides the standing run instead.
    console.warn(
      `[tasks] mention kick for agent ${instance.id} reused the standing run`,
    );
    return;
  }
  await handTaskToInProgressForKick(tx, {
    taskId: args.task.id,
    userId: args.auth.userId,
  });
}

/**
 * Start the task's OWNING automation when the comment @-mentions it.
 *
 * A plain comment on an automation's task is just a comment; @-ing the
 * automation that owns it starts its task workflow, which re-reads the
 * timeline (this comment included) as its feedback. Mentioning any OTHER
 * automation starts nothing — a task runs only the workflow it belongs to.
 *
 * Refusals are deliberately quiet (the comment has already posted) and the
 * gate is WRITE access: commenting is read-level, but running a workflow is
 * an edit, so a read-only member's `@` stays a plain mention. One engine per
 * task across BOTH lanes — a task with a live agent run or a live automation
 * run keeps it; `startWorkflowForTask`'s own duplicate guard backstops the
 * pre-check.
 *
 * Returns whether a start was scheduled, so the caller can skip the steer
 * lane for the same comment.
 */
async function maybeTriggerOwningAutomation(
  tx: TransactionSql,
  args: {
    auth: ProjectAuthContext;
    task: TaskRow;
    mentions: { type: string; id: string }[];
  },
): Promise<boolean> {
  const mentioned = args.mentions.find(
    (mention) => mention.type === 'automation',
  );
  if (mentioned === undefined) return false;
  if (args.task.archivedAt !== null) return false;
  const project = await loadProjectOrThrow(tx, args.task.projectId);
  try {
    // Running a workflow is an EDIT: a read-only member's `@` stays a plain
    // mention rather than a start (commenting itself is read-level).
    assertTaskWritable(project, args.auth);
  } catch {
    return false;
  }
  if (!(await ownsTask(tx, args.task, mentioned.id))) {
    console.warn(
      `[tasks] automation mention "${mentioned.id}" ignored: it does not own task ${args.task.id}`,
    );
    return false;
  }
  const liveAgentRun = await tx<{ id: string }[]>`
    SELECT id FROM app.project_agent_runs
    WHERE task_id = ${args.task.id} AND status IN ('queued', 'running')
    LIMIT 1
  `;
  if (liveAgentRun.length > 0) return false;

  // ENQUEUED, not started inline: the comment must commit first (the
  // workflow re-reads the timeline including it), and the start needs a
  // pool connection of its own — 0.4 scheduled it for exactly this reason.
  await addJobInTx(tx, 'task.start_workflow', {
    organizationId: args.auth.organizationId,
    taskId: args.task.id,
    workflowSlug: mentioned.id,
    startedByUserId: args.auth.userId,
  });
  return true;
}

/**
 * Does this automation OWN the task? Three ownership shapes, in the 0.4
 * order: an app-assigned task names its automation directly, an
 * app-created one names its creator, and an externally-mirrored one matches
 * through its deployed version's task contract. A task with a human or agent
 * assignee is owned by nobody on this lane.
 */
async function ownsTask(
  tx: TransactionSql,
  task: TaskRow,
  name: string,
): Promise<boolean> {
  if (task.assigneeType === 'app') return task.assigneeId === name;
  if (task.assigneeType !== null) return false;
  if (task.createdByType === 'app') return task.createdBy === name;
  if (task.externalSystem === null || task.externalSystem === '') return false;
  const version = await deployedVersion(tx, task.organizationId, name);
  if (version === undefined) return false;
  const row = await versionRow(tx, task.organizationId, name, version);
  const contract =
    row === null ? null : parseTaskSubjectContract(row.taskContract);
  return contract?.externalSystem === task.externalSystem;
}

/** The task fields `startWorkflowForTask` needs, read outside the comment's
 * transaction by the job that actually starts the run. */
export async function loadTaskForWorkflowStart(
  sql: Sql,
  organizationId: string,
  taskId: string,
): Promise<Pick<
  TaskRow,
  | 'id'
  | 'title'
  | 'status'
  | 'projectId'
  | 'externalSystem'
  | 'externalId'
  | 'externalUrl'
> | null> {
  const rows = await sql<
    {
      id: string;
      title: string;
      status: TaskRow['status'];
      projectId: string;
      externalSystem: string | null;
      externalId: string | null;
      externalUrl: string | null;
    }[]
  >`
    SELECT id, title, status, project_id AS "projectId",
           external_system AS "externalSystem",
           external_id AS "externalId", external_url AS "externalUrl"
    FROM app.tasks
    WHERE id = ${taskId} AND org_id = ${organizationId}
      AND archived_at_ms IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}
