import type { Sql, TransactionSql } from 'postgres';

import { TASK_AUDIT_ACTIONS } from '../../../convex/tasks/audit_actions.ts';
import { toJson } from '../../db/sql.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
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
 * Ledger: the mention DIRECTORY (agents + automations rosters) and the
 * fan-outs it powers (notify subscribers, @automation run trigger, steer
 * into a live run) land with collab/agents/automations. Until then mentions
 * persist as an empty list and `comment.created` rides the no-op event seam.
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
  // TODO(collab/agents/automations): mention directory + extraction.
  const mentions: { type: string; id: string }[] = [];
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
  // No mention directory yet (ledgered Tier B) — nothing parses, so nothing
  // is unresolved; the wire field stays so the composer's toast contract
  // (`result.unresolvedMentionTokens`) holds.
  return { messageId, threadId, unresolvedMentionTokens: [] };
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
