import {
  isSerializationFailure,
  markRetryQueueKey,
  RETRY_QUEUE_LOCK_CLASS,
} from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import {
  TASK_AUDIT_ACTIONS,
  TASK_COMMENT_RESOURCE_TYPE,
} from '../../core/tasks/audit_actions.ts';
import {
  TASK_COMMENT_MAX,
  taskCommentRefusal,
} from '../../core/tasks/helpers.ts';
import {
  addedMentions,
  type ResolvedMention,
} from '../../core/tasks/mentions.ts';
import type { CommentEventComment } from '../../core/tasks/types.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { auditChainQueueKey, createAuditLog } from '../audit_logs/service.ts';
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
  listThreadMessagesTail,
  saveMessage,
  THREAD_MESSAGES_READ_MAX,
  updateMessageText,
} from '../threads/store.ts';
import { taskOwnedByAutomation } from './automation-access.ts';
import { mentionAutomationEnabled } from './run-start.ts';
import {
  assertTaskNotArchived,
  assertTaskReadable,
  assertTaskWorkable,
  dispatchMentionedProjectAgent,
  loadTaskOrThrow,
  mayWorkTask,
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
 * A mention's work lanes: the owning automation's RUN TRIGGER is a comment's
 * alone (below); the agent dispatch (`dispatchMentionedProjectAgent`, in
 * `service.ts`) is shared with the task description's mentions.
 */

export { TASK_COMMENT_MAX };

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

/** Retry-queue key for one task's discussion (see `queuedOnTask`). */
export function taskCommentQueueKey(taskId: string): string {
  return `task-comment:${taskId}`;
}

/**
 * The transaction-level lock every comment write takes FIRST. A transaction
 * that writes the task row for another reason and then comments (the
 * overdue nudge's claim) must take it before that write too, or it holds the
 * row while a commenter holds the key — a deadlock pair.
 */
export async function lockTaskCommentQueue(
  tx: TransactionSql,
  taskId: string,
): Promise<void> {
  await tx`
    SELECT pg_advisory_xact_lock(${RETRY_QUEUE_LOCK_CLASS}, hashtext(${taskCommentQueueKey(taskId)}))
  `;
}

/**
 * Run one comment write queued on its task. Every comment on a task bumps
 * the same rows — the task's `comment_count` and the discussion thread's
 * next message slot — so serializable writers that overlap all lose but the
 * first, and a plain retry loses again whenever another commits first: the
 * storm `withRetry`'s five attempts cannot outlast. Two pieces make a retry
 * deterministic instead (the audit chain head's `lockChainHead` is the
 * twin): the transaction-level advisory lock on the task's queue key, taken
 * before the write's first read, queues this transaction behind a retry that
 * holds the same key as a session lock from before its BEGIN (see
 * `transactSerializable`); and a 40001/40P01 raised anywhere in `work` is
 * marked with the key, which is what makes the caller's next attempt take
 * that session lock first. The audit write inside `work` marks a loss at the
 * org's chain head with its own key; marks nest, so that retry queues on the
 * task AND the chain head, in that order (the retry-queue note in
 * `@tale/shared/db/serializable`). Under contention on this task's rows a
 * writer wastes at most one attempt. Plain READ COMMITTED callers pay only
 * the lock, which orders the task's comments and marks nothing. A comment
 * write adds the chain head's key whatever it lost on
 * (`queuedCommentWrite`).
 */
export async function queuedOnTask<T>(
  tx: TransactionSql,
  taskId: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    await lockTaskCommentQueue(tx, taskId);
    return await work();
  } catch (error) {
    throw markRetryQueueKey(error, taskCommentQueueKey(taskId));
  }
}

interface AddedTaskComment {
  messageId: string;
  threadId: string;
  unresolvedMentionTokens: string[];
}

interface AddTaskCommentArgs {
  taskId: string;
  body: string;
  bodyByLocale?: Record<string, string>;
  author?: CommentAuthor;
}

/**
 * A comment write, queued on its task (`queuedOnTask`), that ends on the
 * org's audit chain head. A loss anywhere in it queues the retry on the head
 * too. A loss before the head (a read/write dependency on the org's other
 * comment writes, which serializable isolation reports wherever it finds
 * one) used to carry the task's key alone, so the retry lost again at the
 * head: a burst of commenters across one org's tasks spent up to three
 * attempts a writer, and now and then one ran out of attempts.
 */
function queuedCommentWrite<T>(
  tx: TransactionSql,
  organizationId: string,
  taskId: string,
  work: () => Promise<T>,
): Promise<T> {
  return queuedOnTask(tx, taskId, async () => {
    try {
      return await work();
    } catch (error) {
      if (isSerializationFailure(error)) {
        throw markRetryQueueKey(error, auditChainQueueKey(organizationId));
      }
      throw error;
    }
  });
}

/** Append one comment (message + lockstep meta + count + activity + audit),
 * queued on its task and the org's audit chain (`queuedCommentWrite`).
 * `bodyByLocale` is the same text written natively per language (the
 * workflow `task.comment` native and the automated date nudge carry it);
 * the reader picks their locale and falls back to `body`. */
export function addTaskComment(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: AddTaskCommentArgs,
): Promise<AddedTaskComment> {
  return queuedCommentWrite(tx, auth.organizationId, args.taskId, () =>
    appendTaskComment(tx, auth, args),
  );
}

/** The native review decision owns authorization and the task queue before
 * calling. Persist ordinary visible feedback with its normal notifications,
 * but neither mentions nor platform events may admit another run. */
export function addTaskReviewFeedback(
  tx: TransactionSql,
  args: {
    organizationId: string;
    taskId: string;
    agentId: string;
    body: string;
  },
): Promise<AddedTaskComment> {
  const auth: ProjectAuthContext = {
    organizationId: args.organizationId,
    userId: args.agentId,
    role: 'admin',
    teamIds: [],
  };
  return queuedCommentWrite(tx, args.organizationId, args.taskId, () =>
    appendTaskComment(
      tx,
      auth,
      {
        taskId: args.taskId,
        body: args.body,
        author: { actorType: 'agent', actorId: args.agentId },
      },
      false,
    ),
  );
}

async function appendTaskComment(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: AddTaskCommentArgs,
  dispatch = true,
): Promise<AddedTaskComment> {
  const task = await loadTaskOrThrow(tx, args.taskId, auth.organizationId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  // Commenting is READ-level (0.4 `addTaskComment*`): anyone who can see
  // the task may join its discussion; edit/delete stay behind the task's
  // work gate below.
  assertTaskReadable(project, auth);
  // Archived = read-only for the whole project, its discussions included —
  // the one code every write on it answers, so the app door and the
  // mirrors refuse exactly as the REST comment door does.
  if (project.archivedAt !== null) {
    throw new TaskError('PROJECT_ARCHIVED', 'Project is archived', 403);
  }
  const author: CommentAuthor = args.author ?? {
    actorType: 'user',
    actorId: auth.userId,
  };
  // An archived task's discussion is read-only to people the same way: the
  // app door refuses a stale client exactly as the REST door does. A run
  // still working the task is not refused, since archiving cancels nothing
  // and its report lands beside its status park, which ignores the archive
  // too.
  if (author.actorType === 'user') {
    assertTaskNotArchived(task);
  }
  const body = args.body.trim();
  const refusal = taskCommentRefusal(body);
  if (refusal !== null) {
    throw new TaskError('TASK_COMMENT_INVALID', refusal);
  }

  const threadId = await ensureTaskDiscussionThread(tx, task);
  // Who this comment names. The directory is project-scoped, so only people
  // who can actually open the task are mentionable, and an unclaimed token
  // comes back to the author as a miss.
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
      mentions, body_by_locale, created_at_ms
    ) VALUES (
      ${messageId}, ${auth.organizationId}, ${threadId}, ${args.taskId},
      ${author.actorType}, ${author.actorId},
      ${mentions.length > 0 ? tx.json(toJson(mentions)) : null},
      ${args.bodyByLocale !== undefined ? tx.json(args.bodyByLocale) : null},
      ${Date.now()}
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
  const automationStarted =
    dispatch &&
    (await maybeTriggerOwningAutomation(tx, {
      auth,
      task,
      mentions,
      authorType: author.actorType,
    }));
  // A comment that @-mentions one of the project's agent INSTANCES puts it
  // to work: steering its RUNNING turn, or — when the task is idle —
  // (re)assigning the task to it and kicking a fresh 'mention' run with
  // this comment as feedback (the 0.4 wire). Runs after the automation
  // check so a task can only ever have one engine start per comment.
  if (dispatch && !automationStarted) {
    await dispatchMentionedProjectAgent(tx, {
      auth,
      task,
      project,
      mentions,
      authorType: author.actorType,
      authorId: author.actorId,
      text: body,
      source: 'comment',
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
    resourceType: TASK_COMMENT_RESOURCE_TYPE,
    resourceId: messageId,
    resourceName: task.title,
    metadata: { taskId: args.taskId },
    status: 'success',
  });
  const comment: CommentEventComment = {
    body,
    projectId: task.projectId,
    taskId: args.taskId,
    mentions,
  };
  if (dispatch) {
    await emitEvent(tx, {
      organizationId: auth.organizationId,
      eventType: 'comment.created',
      eventData: { comment },
    });
  }
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

/** How many comments one read answers when the reader names no size — the
 * whole discussion for every task under it, exactly what readers saw before
 * the feed paged. */
export const TASK_COMMENT_PAGE_DEFAULT = 200;
/** The most one read may ask for (the message store's own ceiling). */
export const TASK_COMMENT_PAGE_MAX = THREAD_MESSAGES_READ_MAX;

/**
 * The wire form of a page cursor (a response's `continueCursor`): the
 * message order the next older page ends before, as a decimal string. Absent
 * or empty reads the newest page; anything else is refused at the door.
 */
export const taskCommentCursorSchema = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    if (raw === undefined || raw === '') return undefined;
    if (!/^\d{1,9}$/.test(raw)) {
      ctx.addIssue({ code: 'custom', message: 'invalid cursor' });
      return z.NEVER;
    }
    return Number(raw);
  });

export interface TaskCommentPage {
  /** Chronological within the page (oldest first). */
  comments: TaskCommentItem[];
  /** Whether comments OLDER than this page exist. */
  hasMore: boolean;
  /** Read the next older page with `before: nextCursor`; null at the start. */
  nextCursor: number | null;
}

/**
 * The comment feed, NEWEST page first: the last `limit` comments (or the
 * `limit` before the `before` cursor — a message order from a previous
 * page's `nextCursor`), chronological within the page, plus whether older
 * ones remain. A discussion is read from its tail because that is where
 * the state of the task lives — agent runs report into it, so a busy task
 * outgrows any fixed window, and a window pinned to the START hid every
 * comment after the 200th while the POST kept answering 201.
 */
export async function listTaskComments(
  sql: Sql,
  auth: ProjectAuthContext,
  taskId: string,
  options: { limit?: number; before?: number } = {},
): Promise<TaskCommentPage> {
  const task = await loadTaskOrThrow(sql, taskId, auth.organizationId);
  const project = await loadProjectOrThrow(sql, task.projectId);
  assertTaskReadable(project, auth);
  return readTaskCommentPage(sql, task, options);
}

/**
 * {@link listTaskComments}'s page for a task the caller has ALREADY judged
 * readable — the agent read (`task_get`, through the shim's
 * `getTaskContextForAgent`), whose scope check runs at the workspace-tool
 * door before any read. The page, its order and its cursor are the feed's.
 */
export async function readTaskCommentPage(
  sql: Sql,
  task: Pick<TaskRow, 'id' | 'discussionThreadId'>,
  options: { limit?: number; before?: number } = {},
): Promise<TaskCommentPage> {
  const taskId = task.id;
  if (!task.discussionThreadId) {
    return { comments: [], hasMore: false, nextCursor: null };
  }
  const limit = Math.min(
    Math.max(options.limit ?? TASK_COMMENT_PAGE_DEFAULT, 1),
    TASK_COMMENT_PAGE_MAX,
  );
  // Comments are whole turns (step 0), so a message order alone is the
  // cursor; the store's (order, step) keyset gets the step pinned to 0.
  const tail = await listThreadMessagesTail(sql, task.discussionThreadId, {
    limit,
    ...(options.before !== undefined
      ? { before: { order: options.before, stepOrder: 0 } }
      : {}),
  });
  const messageIds = tail.messages.map((message) => message.id);
  const meta =
    messageIds.length === 0
      ? []
      : await sql<
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
          WHERE task_id = ${taskId} AND message_id = ANY(${messageIds})
        `;
  const metaById = new Map(meta.map((row) => [row.messageId, row]));
  const comments = tail.messages.flatMap((message) => {
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
  return {
    comments,
    hasMore: tail.hasMore,
    nextCursor: tail.nextBefore?.order ?? null,
  };
}

interface CommentMeta {
  taskId: string;
  authorType: string;
  authorId: string;
  mentions: ResolvedMention[] | null;
}

async function loadCommentMeta(
  tx: TransactionSql | Sql,
  messageId: string,
): Promise<CommentMeta> {
  const rows = await tx<
    {
      taskId: string;
      authorType: string;
      authorId: string;
      mentions: ResolvedMention[] | null;
    }[]
  >`
    SELECT task_id AS "taskId", author_type AS "authorType",
           author_id AS "authorId", mentions
    FROM app.task_discussion_message_meta WHERE message_id = ${messageId}
  `;
  const meta = rows[0];
  if (!meta) {
    throw new TaskError('TASK_COMMENT_NOT_FOUND', 'Comment not found', 404);
  }
  return meta;
}

/**
 * Who may edit or delete a comment: its author, with the read access posting
 * it took — a member fixes their own comment on anyone's task — or an
 * admin, whose moderation of someone else's words is a change to the task
 * and so passes its work gate. An archived project or task is read-only for
 * both.
 */
async function assertCommentModifiable(
  tx: TransactionSql,
  project: ProjectRow,
  task: TaskRow,
  auth: ProjectAuthContext,
  meta: { authorType: string; authorId: string },
): Promise<void> {
  const isOwn = meta.authorType === 'user' && meta.authorId === auth.userId;
  if (isOwn) {
    assertTaskReadable(project, auth);
    if (project.archivedAt !== null) {
      throw new TaskError('PROJECT_ARCHIVED', 'Project is archived', 403);
    }
  } else {
    await assertTaskWorkable(tx, project, task, auth);
    const isAdmin = auth.role === 'owner' || auth.role === 'admin';
    if (!isAdmin) {
      throw new TaskError(
        'TASK_COMMENT_FORBIDDEN',
        'Only the author or an admin may modify a comment',
        403,
      );
    }
  }
  assertTaskNotArchived(task);
}

/**
 * Edit one comment's body — and RE-RESOLVE what it names.
 *
 * An edit is a second chance to mention someone: adding `@handle` to a
 * comment has to reach them, and the stored mention set has to stay the
 * truth of who the comment names (it is what the feed renders and what the
 * next edit diffs against). Only the NEWLY added mentions fan out —
 * rewording prose around an existing `@handle` must not re-notify, and
 * re-notifying the whole set on every edit is exactly what the 0.4
 * `addedMentions` diff existed to prevent.
 *
 * The fan-out is the MENTION half of {@link addTaskComment} only: the bell
 * and auto-subscribe for the newly named, no subscriber re-alert (this is
 * not a fresh comment), and `comment.mentioned` rather than
 * `comment.created`. Editing never starts an engine — the automation
 * trigger and the agent dispatch belong to a posted comment.
 */
export async function editTaskComment(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: { messageId: string; body: string },
): Promise<void> {
  const meta = await loadCommentMeta(tx, args.messageId);
  const task = await loadTaskOrThrow(tx, meta.taskId, auth.organizationId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  await assertCommentModifiable(tx, project, task, auth, meta);
  const body = args.body.trim();
  const refusal = taskCommentRefusal(body);
  if (refusal !== null) {
    throw new TaskError('TASK_COMMENT_INVALID', refusal);
  }
  const resolved = await resolveSurfaceMentions(tx, {
    organizationId: auth.organizationId,
    body,
    projectId: task.projectId,
  });
  const mentions = resolved.mentions;
  const added = addedMentions(meta.mentions ?? [], mentions);
  await updateMessageText(tx, args.messageId, body);
  await tx`
    UPDATE app.task_discussion_message_meta
    SET edited_at_ms = ${Date.now()},
        body_by_locale = NULL,
        mentions = ${mentions.length > 0 ? tx.json(toJson(mentions)) : null}
    WHERE message_id = ${args.messageId}
  `;
  if (added.length > 0) {
    await notifyTaskComment(tx, {
      task,
      commentId: args.messageId,
      mentions: added,
      actorType: 'user',
      actorId: auth.userId,
      notifySubscribers: false,
    });
    const comment: CommentEventComment = {
      body,
      projectId: task.projectId,
      taskId: meta.taskId,
      mentions: added,
    };
    await emitEvent(tx, {
      organizationId: auth.organizationId,
      eventType: 'comment.mentioned',
      eventData: {
        comment,
        taskId: meta.taskId,
        mentions: added,
        actorType: 'user',
        actorId: auth.userId,
      },
    });
  }
  await createAuditLog(tx, {
    organizationId: auth.organizationId,
    actorId: auth.userId,
    ...(auth.email !== undefined ? { actorEmail: auth.email } : {}),
    actorType: 'user',
    action: TASK_AUDIT_ACTIONS.commentUpdated,
    category: 'data',
    resourceType: TASK_COMMENT_RESOURCE_TYPE,
    resourceId: args.messageId,
    resourceName: task.title,
    metadata: { taskId: meta.taskId, addedMentionCount: added.length },
    status: 'success',
  });
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'task',
    entityId: meta.taskId,
  });
}

/** Delete one comment, queued on its task and the org's audit chain
 * (`queuedCommentWrite`): the count it decrements is the same hot row every
 * append bumps. */
export async function deleteTaskComment(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  messageId: string,
): Promise<void> {
  const meta = await loadCommentMeta(tx, messageId);
  await queuedCommentWrite(tx, auth.organizationId, meta.taskId, () =>
    removeTaskComment(tx, auth, messageId, meta),
  );
}

async function removeTaskComment(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  messageId: string,
  meta: CommentMeta,
): Promise<void> {
  const task = await loadTaskOrThrow(tx, meta.taskId, auth.organizationId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  await assertCommentModifiable(tx, project, task, auth, meta);
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
    resourceType: TASK_COMMENT_RESOURCE_TYPE,
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
 * Start the task's OWNING automation when the comment @-mentions it.
 *
 * A plain comment on an automation's task is just a comment; @-ing the
 * automation that owns it starts its task workflow, which re-reads the
 * timeline (this comment included) as its feedback. Mentioning any OTHER
 * automation starts nothing — a task runs only the workflow it belongs to.
 *
 * Refusals are deliberately quiet (the comment has already posted) and the
 * gate is the task's work gate: commenting is read-level, but running a
 * workflow is a change to the task, so the `@` of someone who may not work
 * it stays a plain mention. One engine per
 * task across BOTH lanes — a task with a live agent run or a live automation
 * run keeps it; `startWorkflowForTask`'s own duplicate guard backstops the
 * pre-check.
 *
 * Only a HUMAN's comment starts anything — the same rule the agent lane's
 * dispatcher keeps. An agent- or workflow-authored comment naming the owning
 * automation would restart the very engine that wrote it, and each iteration
 * is a metered agent turn; `startWorkflowForTask`'s one-live-run-per-task
 * guard (per task, whichever automation holds it) blocks a concurrent second
 * start, not a sequential loop, so the
 * author type is the only thing standing between a comment and that loop.
 *
 * Returns whether a start was scheduled, so the caller can skip the steer
 * lane for the same comment.
 */
/**
 * May a comment with this author type start the automation that owns the task?
 * Only a human's.
 *
 * 0.4 reached the trigger from `applyUserTaskComment` alone, so the question
 * never came up. 0.5 merged the user and agent doors into one
 * `addTaskComment`, and an agent- or workflow-authored comment naming the
 * owning automation then restarted the engine that wrote it — a sequential
 * loop of metered agent turns. The one-live-run guard does not stop it: it
 * blocks a CONCURRENT second start, not a later one.
 */
export function commentCanStartAutomation(authorType: string): boolean {
  return authorType === 'user';
}

async function maybeTriggerOwningAutomation(
  tx: TransactionSql,
  args: {
    auth: ProjectAuthContext;
    task: TaskRow;
    mentions: { type: string; id: string }[];
    authorType: string;
  },
): Promise<boolean> {
  if (!commentCanStartAutomation(args.authorType)) return false;
  const mentioned = args.mentions.find(
    (mention) => mention.type === 'automation',
  );
  if (mentioned === undefined) return false;
  if (args.task.archivedAt !== null) return false;
  const project = await loadProjectOrThrow(tx, args.task.projectId);
  // Running a workflow is a change to the task: the `@` of someone who may
  // not work it stays a plain mention (commenting itself is read-level).
  if (!(await mayWorkTask(tx, project, args.task, args.auth))) return false;
  if (!(await taskOwnedByAutomation(tx, args.task, mentioned.id))) {
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
  if (!(await mentionAutomationEnabled(tx, args.auth.organizationId)))
    return false;

  // ENQUEUED, not started inline: the comment must commit first (the
  // workflow re-reads the timeline including it), and the start needs a
  // pool connection of its own — 0.4 scheduled it for exactly this reason.
  // One queued start per (task, automation): two @mentions landing before
  // the worker runs collapse into one job; the start itself is guarded
  // again under a lock, so a job that does run beside a live run reuses it.
  await addJobInTx(
    tx,
    'task.start_workflow',
    {
      organizationId: args.auth.organizationId,
      taskId: args.task.id,
      workflowSlug: mentioned.id,
      startedByUserId: args.auth.userId,
    },
    {
      singletonKey: `task.start_workflow:${args.auth.organizationId}:${args.task.id}:${mentioned.id}`,
    },
  );
  return true;
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
