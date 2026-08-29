import type { Sql, TransactionSql } from 'postgres';

import { TASK_AUDIT_ACTIONS } from '../../../convex/tasks/audit_actions.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { resolveSurfaceMentions } from '../collab/mention-directory.ts';
import { notifyTaskComment } from '../collab/service.ts';
import { emitEvent } from '../events/emit.ts';
import {
  loadProjectOrThrow,
  type ProjectAuthContext,
} from '../projects/service.ts';
import {
  createThread,
  deleteMessage,
  listThreadMessages,
  saveMessage,
  updateMessageText,
} from '../threads/store.ts';
import {
  assertTaskReadable,
  assertTaskWritable,
  loadTaskOrThrow,
  TaskError,
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
  // A comment that @-mentions the agent CURRENTLY running this task steers
  // the live turn instead of being dropped: the steer host injects it over
  // the harness's held-open stdin, or restarts the exec around it. A queued
  // (capacity-parked) run needs nothing — its start reads the brief after
  // this comment posted.
  await maybeSteerLiveRun(tx, {
    organizationId: auth.organizationId,
    taskId: args.taskId,
    mentions,
    authorType: author.actorType,
    authorId: author.actorId,
    feedback: body,
  });
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
 * Enqueue a steer when the comment names the agent instance that owns a
 * LIVE run on this task.
 *
 * Only a `running` run is steerable: a queued one has not read its brief
 * yet (the comment is already in the discussion it will read), and a
 * settled one is handled by the steer host's own fallback. Only a HUMAN's
 * comment steers — an agent's own comment naming itself would loop.
 */
async function maybeSteerLiveRun(
  tx: TransactionSql,
  args: {
    organizationId: string;
    taskId: string;
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

  const runs = await tx<
    {
      id: string;
      agentId: string;
      execId: string;
      sessionId: string;
      harness: string;
      model: string;
      modelProvider: string | null;
      deadlineAt: number;
    }[]
  >`
    SELECT id, agent_id AS "agentId", exec_id AS "execId",
           session_id AS "sessionId", harness, model,
           model_provider AS "modelProvider",
           deadline_at_ms::float8 AS "deadlineAt"
    FROM app.project_agent_runs
    WHERE task_id = ${args.taskId} AND org_id = ${args.organizationId}
      AND status = 'running'
    LIMIT 1
  `;
  const run = runs[0];
  if (run === undefined || !mentionedAgentIds.has(run.agentId)) return;

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
    organizationId: args.organizationId,
    runId: run.id,
    taskId: args.taskId,
    agentId: run.agentId,
    execId: run.execId,
    sessionId: run.sessionId,
    harness: run.harness,
    deadlineAt: run.deadlineAt,
    model: run.model,
    ...(run.modelProvider !== null ? { modelProvider: run.modelProvider } : {}),
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
}
