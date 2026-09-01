import type { Sql, TransactionSql } from 'postgres';

import { isActionableNotificationType } from '../../../lib/shared/attention.ts';
import {
  coalesceKeyFor,
  NOTIFICATION_EMAIL_DEBOUNCE_MS,
} from '../../core/collab/coalesce.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';

/**
 * Collaboration core — the 0.5 twin of `convex/collab/*`: per-user content
 * notifications with the COALESCE discipline (the pure collapse identity
 * `coalesceKeyFor` REUSED verbatim: while an unread twin exists, a later
 * event on the same dimension rewrites it in place; an `undoes` event drops
 * both), task subscriptions, and tri-state preferences (undefined = ON;
 * the review group is locked always-on — a safety signal).
 *
 * The 0.4 debounced EMAIL sink (`emailJobId` + the deliver action) rides
 * the conversations/SMTP domain — until it lands, rows write with no email
 * job and the bell is the delivery surface.
 */

type Db = Sql | TransactionSql;

export type NotificationActorType = 'user' | 'agent' | 'system';

export interface CollabNotificationInput {
  userId: string;
  organizationId: string;
  type: string;
  titleKey: string;
  bodyKey: string;
  params?: Record<string, unknown>;
  resourceType: string;
  resourceId: string;
  taskId?: string;
  actorType: NotificationActorType;
  actorId?: string;
  /** This event UNDOES its dimension (an unassignment after an assignment):
   * when the row it would replace is still unread, both drop. */
  undoes?: boolean;
}

/** The per-type preference column (the 0.4 PREF_FIELD map). */
const PREF_FIELD: Record<string, string> = {
  task_assigned: 'task_assigned',
  task_unassigned: 'task_assigned',
  task_status_changed: 'task_status_changed',
  task_commented: 'task_commented',
  mention: 'mention',
  task_deadline: 'task_deadlines',
  task_review_requested: 'task_review',
  task_review_resolved: 'task_review',
  task_reviewer_assigned: 'task_review',
  document_review_requested: 'task_review',
  document_review_resolved: 'task_review',
  agent_escalation: 'escalation',
  automation_failed: 'automation_alerts',
  budget_alert: 'automation_alerts',
  runtime_offline: 'automation_alerts',
  conversation_message: 'conversation_messages',
  conversation_assigned: 'conversation_messages',
};

/** Tri-state preference resolution: undefined → default ON. The review
 * group ignores any stored value — the settings UI locks it always-on. */
export async function isNotificationAllowed(
  db: Db,
  userId: string,
  organizationId: string,
  type: string,
): Promise<boolean> {
  const field = PREF_FIELD[type];
  if (field === undefined) return true;
  if (field === 'task_review') return true;
  const rows = await db<Record<string, boolean | null>[]>`
    SELECT task_assigned, task_status_changed, task_commented, mention,
           task_deadlines, escalation, automation_alerts,
           conversation_messages
    FROM app.notification_preferences
    WHERE user_id = ${userId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  const prefs = rows[0];
  if (!prefs) return true;
  const value = prefs[field];
  return value === null || value === undefined ? true : value;
}

export type CoalesceOutcome = 'inserted' | 'rewritten' | 'cancelled';

/** The newest UNREAD twin scan bound (the 0.4 cap). */
const UNREAD_SCAN_CAP = 100;

/** The email debounce window (0.4 parity: 60s). Read at call time so the
 * integration harness can shorten it via NOTIFICATION_EMAIL_DEBOUNCE_MS. */
export function notificationEmailDebounceMs(): number {
  return (
    Number(process.env.NOTIFICATION_EMAIL_DEBOUNCE_MS ?? '') ||
    NOTIFICATION_EMAIL_DEBOUNCE_MS
  );
}

/**
 * Hand the row to the email sink after the debounce window. The epoch bump
 * replaces the 0.4 cancel+reschedule: the fired job sends only when its
 * epoch is still the row's current one, so the older job of a rewritten row
 * no-ops and the newer one carries the final state. Non-actionable types
 * never email.
 */
async function scheduleNotificationEmail(
  db: Db,
  args: { notificationId: string; type: string },
): Promise<void> {
  if (!isActionableNotificationType(args.type)) return;
  const bumped = await db<{ emailEpoch: number }[]>`
    UPDATE app.user_notifications SET email_epoch = email_epoch + 1
    WHERE id = ${args.notificationId}
    RETURNING email_epoch::float8 AS "emailEpoch"
  `;
  const epoch = bumped[0]?.emailEpoch;
  if (epoch === undefined) return;
  await addJobInTx(
    db,
    'notification.email',
    { notificationId: args.notificationId, epoch },
    { startAfter: new Date(Date.now() + notificationEmailDebounceMs()) },
  );
}

/**
 * Write (or rewrite, or cancel) one notification row. Callers own the
 * preference gate — this is the mechanics of one row.
 */
export async function writeCoalescedNotification(
  db: Db,
  args: CollabNotificationInput,
): Promise<CoalesceOutcome> {
  const key = coalesceKeyFor(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reused pure fn narrows types internally; unknown types simply never collapse
    args as unknown as Parameters<typeof coalesceKeyFor>[0],
  );
  let existingId: string | null = null;
  if (key !== null) {
    const recent = await db<{ id: string; coalesceKey: string | null }[]>`
      SELECT id, coalesce_key AS "coalesceKey" FROM app.user_notifications
      WHERE user_id = ${args.userId} AND org_id = ${args.organizationId}
        AND read = false
      ORDER BY seq DESC
      LIMIT ${UNREAD_SCAN_CAP}
    `;
    existingId = recent.find((row) => row.coalesceKey === key)?.id ?? null;
  }

  if (existingId !== null && args.undoes === true) {
    await db`DELETE FROM app.user_notifications WHERE id = ${existingId}`;
    await emitHintInTx(db, {
      orgId: args.organizationId,
      entity: 'user_notification',
      entityId: null,
    });
    return 'cancelled';
  }

  const now = Date.now();
  if (existingId !== null) {
    // Rewrite in place: same row, current truth; `createdAt` moves so the
    // bell re-sorts to the top — this IS news, just not a second item.
    await db`
      UPDATE app.user_notifications SET
        type = ${args.type}, title_key = ${args.titleKey},
        body_key = ${args.bodyKey},
        params = ${args.params === undefined ? null : db.json(toJson(args.params))},
        resource_type = ${args.resourceType}, resource_id = ${args.resourceId},
        task_id = ${args.taskId ?? null}, actor_type = ${args.actorType},
        actor_id = ${args.actorId ?? null}, created_at_ms = ${now}
      WHERE id = ${existingId}
    `;
    await scheduleNotificationEmail(db, {
      notificationId: existingId,
      type: args.type,
    });
    await emitHintInTx(db, {
      orgId: args.organizationId,
      entity: 'user_notification',
      entityId: null,
    });
    return 'rewritten';
  }

  const inserted = await db<{ id: string }[]>`
    INSERT INTO app.user_notifications (
      user_id, org_id, type, title_key, body_key, params, resource_type,
      resource_id, task_id, actor_type, actor_id, read, created_at_ms,
      coalesce_key
    ) VALUES (
      ${args.userId}, ${args.organizationId}, ${args.type}, ${args.titleKey},
      ${args.bodyKey},
      ${args.params === undefined ? null : db.json(toJson(args.params))},
      ${args.resourceType}, ${args.resourceId}, ${args.taskId ?? null},
      ${args.actorType}, ${args.actorId ?? null}, false, ${now},
      ${key}
    )
    RETURNING id
  `;
  const insertedId = inserted[0]?.id;
  if (insertedId !== undefined) {
    await scheduleNotificationEmail(db, {
      notificationId: insertedId,
      type: args.type,
    });
  }
  await emitHintInTx(db, {
    orgId: args.organizationId,
    entity: 'user_notification',
    entityId: null,
  });
  return 'inserted';
}

/** The preference-gated write most emitters use. */
export async function notifyUser(
  db: Db,
  args: CollabNotificationInput,
): Promise<void> {
  if (
    !(await isNotificationAllowed(
      db,
      args.userId,
      args.organizationId,
      args.type,
    ))
  ) {
    return;
  }
  await writeCoalescedNotification(db, args);
}

export interface UserNotificationRow {
  id: string;
  type: string;
  titleKey: string;
  bodyKey: string;
  params: Record<string, unknown> | null;
  resourceType: string;
  resourceId: string;
  taskId: string | null;
  actorType: string;
  actorId: string | null;
  read: boolean;
  createdAt: number;
}

export async function listMyNotifications(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    cursor?: number;
    limit?: number;
    unreadOnly?: boolean;
  },
): Promise<{ rows: UserNotificationRow[]; nextCursor: number | null }> {
  const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
  const page = await sql<(UserNotificationRow & { seq: number })[]>`
    SELECT id, type, title_key AS "titleKey", body_key AS "bodyKey", params,
           resource_type AS "resourceType", resource_id AS "resourceId",
           task_id AS "taskId", actor_type AS "actorType",
           actor_id AS "actorId", read, created_at_ms::float8 AS "createdAt",
           seq::float8 AS seq
    FROM app.user_notifications
    WHERE user_id = ${args.userId} AND org_id = ${args.organizationId}
      AND (${args.unreadOnly === true} = false OR read = false)
      AND (${args.cursor ?? null}::bigint IS NULL
           OR seq < ${args.cursor ?? null})
    ORDER BY seq DESC
    LIMIT ${limit + 1}
  `;
  const rows = page.slice(0, limit);
  return {
    rows: rows.map(({ seq: _seq, ...row }) => row),
    nextCursor: page.length > limit ? (rows.at(-1)?.seq ?? null) : null,
  };
}

export async function myUnreadCount(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.user_notifications
    WHERE user_id = ${userId} AND org_id = ${organizationId} AND read = false
  `;
  return Number(rows[0]?.count ?? '0');
}

export async function markNotificationRead(
  sql: Sql,
  args: { organizationId: string; userId: string; notificationId: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE app.user_notifications SET read = true, read_at_ms = ${Date.now()}
    WHERE id = ${args.notificationId} AND user_id = ${args.userId}
      AND org_id = ${args.organizationId} AND read = false
    RETURNING id
  `;
  return rows.length > 0;
}

export async function markAllNotificationsRead(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    UPDATE app.user_notifications SET read = true, read_at_ms = ${Date.now()}
    WHERE user_id = ${userId} AND org_id = ${organizationId} AND read = false
    RETURNING id
  `;
  return rows.length;
}

// ------------------------------------------------------------ subscriptions

/** Idempotent task subscription upsert. */
export async function autoSubscribe(
  db: Db,
  args: {
    organizationId: string;
    taskId: string;
    subscriberType: 'user' | 'agent';
    subscriberId: string;
    reason: string;
  },
): Promise<void> {
  await db`
    INSERT INTO app.task_subscriptions (
      org_id, task_id, subscriber_type, subscriber_id, reason, created_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.taskId}, ${args.subscriberType},
      ${args.subscriberId}, ${args.reason}, ${Date.now()}
    )
    ON CONFLICT (task_id, subscriber_type, subscriber_id) DO NOTHING
  `;
}

export async function setTaskSubscription(
  sql: Sql,
  args: {
    organizationId: string;
    taskId: string;
    userId: string;
    subscribed?: boolean;
    muted?: boolean;
  },
): Promise<void> {
  if (args.subscribed === false) {
    await sql`
      DELETE FROM app.task_subscriptions
      WHERE task_id = ${args.taskId} AND subscriber_type = 'user'
        AND subscriber_id = ${args.userId}
    `;
    return;
  }
  await autoSubscribe(sql, {
    organizationId: args.organizationId,
    taskId: args.taskId,
    subscriberType: 'user',
    subscriberId: args.userId,
    reason: 'manual',
  });
  if (args.muted !== undefined) {
    await sql`
      UPDATE app.task_subscriptions SET muted = ${args.muted}
      WHERE task_id = ${args.taskId} AND subscriber_type = 'user'
        AND subscriber_id = ${args.userId}
    `;
  }
}

export async function getTaskSubscription(
  sql: Sql,
  args: { taskId: string; userId: string },
): Promise<{ subscribed: boolean; muted: boolean }> {
  const rows = await sql<{ muted: boolean | null }[]>`
    SELECT muted FROM app.task_subscriptions
    WHERE task_id = ${args.taskId} AND subscriber_type = 'user'
      AND subscriber_id = ${args.userId}
    LIMIT 1
  `;
  return rows.length === 0
    ? { subscribed: false, muted: false }
    : { subscribed: true, muted: rows[0]?.muted === true };
}

/** Unmuted human watchers of a task — the audience for outcomes. */
export async function taskSubscriberUserIds(
  db: Db,
  taskId: string,
): Promise<string[]> {
  const rows = await db<{ subscriberId: string }[]>`
    SELECT subscriber_id AS "subscriberId" FROM app.task_subscriptions
    WHERE task_id = ${taskId} AND subscriber_type = 'user'
      AND muted IS NOT true
  `;
  return rows.map((row) => row.subscriberId);
}

// -------------------------------------------------------------- preferences

const PREF_COLUMNS = [
  'task_assigned',
  'task_status_changed',
  'task_commented',
  'mention',
  'task_deadlines',
  'task_review',
  'escalation',
  'automation_alerts',
  'conversation_messages',
  'actionable_email',
] as const;

export type NotificationPreferences = Partial<
  Record<(typeof PREF_COLUMNS)[number], boolean | null>
>;

export async function getNotificationPreferences(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<Record<string, boolean | null>> {
  const rows = await sql<Record<string, boolean | null>[]>`
    SELECT task_assigned AS "taskAssigned",
           task_status_changed AS "taskStatusChanged",
           task_commented AS "taskCommented", mention,
           task_deadlines AS "taskDeadlines", task_review AS "taskReview",
           escalation, automation_alerts AS "automationAlerts",
           conversation_messages AS "conversationMessages",
           actionable_email AS "actionableEmail"
    FROM app.notification_preferences
    WHERE user_id = ${userId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  return rows[0] ?? {};
}

export async function setNotificationPreferences(
  sql: Sql,
  organizationId: string,
  userId: string,
  prefs: Record<string, boolean | undefined>,
): Promise<void> {
  const value = (name: string): boolean | null =>
    prefs[name] === undefined ? null : (prefs[name] ?? null);
  await sql`
    INSERT INTO app.notification_preferences (
      user_id, org_id, task_assigned, task_status_changed, task_commented,
      mention, task_deadlines, task_review, escalation, automation_alerts,
      conversation_messages, actionable_email, updated_at_ms
    ) VALUES (
      ${userId}, ${organizationId}, ${value('taskAssigned')},
      ${value('taskStatusChanged')}, ${value('taskCommented')},
      ${value('mention')}, ${value('taskDeadlines')}, ${value('taskReview')},
      ${value('escalation')}, ${value('automationAlerts')},
      ${value('conversationMessages')}, ${value('actionableEmail')},
      ${Date.now()}
    )
    ON CONFLICT (user_id, org_id) DO UPDATE SET
      task_assigned = EXCLUDED.task_assigned,
      task_status_changed = EXCLUDED.task_status_changed,
      task_commented = EXCLUDED.task_commented,
      mention = EXCLUDED.mention,
      task_deadlines = EXCLUDED.task_deadlines,
      task_review = EXCLUDED.task_review,
      escalation = EXCLUDED.escalation,
      automation_alerts = EXCLUDED.automation_alerts,
      conversation_messages = EXCLUDED.conversation_messages,
      actionable_email = EXCLUDED.actionable_email,
      updated_at_ms = EXCLUDED.updated_at_ms
  `;
}

// ------------------------------------------------------ review bell writers

/** A user's display name for localized copy, or null (agent actors fall back
 * to the impersonal body). */
async function resolveUserDisplayName(
  db: Db,
  userId: string,
): Promise<string | null> {
  const rows = await db<{ name: string | null; email: string | null }[]>`
    SELECT "name", "email" FROM "user" WHERE "id" = ${userId} LIMIT 1
  `;
  const row = rows[0];
  return row?.name ?? row?.email ?? null;
}

export type TaskReviewSubmitter =
  | { kind: 'agent'; name?: string }
  | { kind: 'user'; userId: string };

/** Actionable review request to the designated reviewer (pref gate skipped —
 * the review group is locked on). */
export async function notifyTaskReviewRequested(
  db: Db,
  args: {
    organizationId: string;
    task: { id: string; projectId: string; title: string };
    reviewerUserId: string;
    approvalId: string;
    submitter: TaskReviewSubmitter;
  },
): Promise<void> {
  if (
    args.submitter.kind === 'user' &&
    args.submitter.userId === args.reviewerUserId
  ) {
    return;
  }
  const actorName =
    args.submitter.kind === 'user'
      ? await resolveUserDisplayName(db, args.submitter.userId)
      : null;
  const agentName =
    args.submitter.kind === 'agent' ? args.submitter.name : undefined;
  const bodyKey =
    args.submitter.kind === 'agent'
      ? agentName
        ? 'taskReviewRequestedBody'
        : 'taskReviewRequestedBodyNoAgent'
      : actorName
        ? 'taskReviewRequestedByBody'
        : 'taskReviewRequestedBodyHuman';
  await writeCoalescedNotification(db, {
    userId: args.reviewerUserId,
    organizationId: args.organizationId,
    type: 'task_review_requested',
    titleKey: 'taskReviewRequested',
    bodyKey,
    params: {
      taskId: args.task.id,
      projectId: args.task.projectId,
      taskTitle: args.task.title,
      approvalId: args.approvalId,
      ...(agentName ? { agentSlug: agentName } : {}),
      ...(actorName ? { actor: actorName } : {}),
    },
    resourceType: 'task_review',
    resourceId: args.approvalId,
    taskId: args.task.id,
    ...(args.submitter.kind === 'user'
      ? { actorType: 'user' as const, actorId: args.submitter.userId }
      : {
          actorType: 'agent' as const,
          ...(agentName !== undefined ? { actorId: agentName } : {}),
        }),
  });
}

/** Review outcome to watchers (minus the deciding actor), pref-gated. */
export async function notifyTaskReviewResolved(
  db: Db,
  args: {
    organizationId: string;
    task: { id: string; projectId: string; title: string };
    decision: 'approve' | 'request_changes';
    decidedByUserId: string;
    recipientUserIds: string[];
  },
): Promise<void> {
  const actorName = await resolveUserDisplayName(db, args.decidedByUserId);
  const recipients = new Set(args.recipientUserIds);
  recipients.delete(args.decidedByUserId);
  for (const userId of recipients) {
    await notifyUser(db, {
      userId,
      organizationId: args.organizationId,
      type: 'task_review_resolved',
      titleKey:
        args.decision === 'approve'
          ? 'taskReviewApproved'
          : 'taskReviewChangesRequested',
      bodyKey:
        args.decision === 'approve'
          ? actorName
            ? 'taskReviewApprovedByBody'
            : 'taskReviewApprovedBody'
          : actorName
            ? 'taskReviewChangesRequestedByBody'
            : 'taskReviewChangesRequestedBody',
      params: {
        taskId: args.task.id,
        projectId: args.task.projectId,
        taskTitle: args.task.title,
        ...(actorName ? { actor: actorName } : {}),
      },
      resourceType: 'task',
      resourceId: args.task.id,
      taskId: args.task.id,
      actorType: 'user',
      actorId: args.decidedByUserId,
    });
  }
}

/** Mark this approval's unread request bells read — the review was decided
 * or superseded; the bell must stop ringing. Matches only THIS approval. */
export async function dismissReviewRequestNotifications(
  db: Db,
  args: { organizationId: string; approvalId: string },
): Promise<number> {
  const rows = await db<{ id: string }[]>`
    UPDATE app.user_notifications SET read = true, read_at_ms = ${Date.now()}
    WHERE org_id = ${args.organizationId}
      AND type = 'task_review_requested' AND read = false
      AND (resource_id = ${args.approvalId}
           OR params ->> 'approvalId' = ${args.approvalId})
    RETURNING id
  `;
  return rows.length;
}

// ---------------------------------------------------------- task emitters

interface TaskFacts {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
}

/** Exclude the actor (only when the actor is a human). */
function withoutActor(
  ids: Iterable<string>,
  actorType: NotificationActorType,
  actorId: string,
): string[] {
  const set = new Set(ids);
  if (actorType === 'user') set.delete(actorId);
  return [...set];
}

/** A human actor resolves to a proper noun; agents fall back to the
 * impersonal body rather than leaking an English word into DE/FR copy. */
async function resolveActorName(
  db: Db,
  actorType: NotificationActorType,
  actorId: string,
): Promise<string | null> {
  if (actorType !== 'user') return null;
  return resolveUserDisplayName(db, actorId);
}

export async function notifyTaskStatusChanged(
  db: Db,
  args: {
    task: TaskFacts;
    fromStatus: string;
    toStatus: string;
    actorType: NotificationActorType;
    actorId: string;
  },
): Promise<void> {
  const recipients = withoutActor(
    await taskSubscriberUserIds(db, args.task.id),
    args.actorType,
    args.actorId,
  );
  const actorName = await resolveActorName(db, args.actorType, args.actorId);
  for (const userId of recipients) {
    await notifyUser(db, {
      userId,
      organizationId: args.task.organizationId,
      type: 'task_status_changed',
      titleKey: 'taskStatusChanged',
      bodyKey: actorName ? 'taskStatusChangedByBody' : 'taskStatusChangedBody',
      params: {
        title: args.task.title,
        projectId: args.task.projectId,
        from: args.fromStatus,
        to: args.toStatus,
        ...(actorName ? { actor: actorName } : {}),
      },
      resourceType: 'task',
      resourceId: args.task.id,
      taskId: args.task.id,
      actorType: args.actorType,
      actorId: args.actorId,
    });
  }
}

/**
 * The assignment fan-out: the human who LOST the work is told (an unread
 * "assigned" twin collapses to nothing — `undoes`), the new human assignee
 * is subscribed and told (never for self-assignment); agents and apps have
 * no inbox.
 */
export async function notifyTaskAssigned(
  db: Db,
  args: {
    task: TaskFacts;
    assigneeType: 'user' | 'agent' | 'app' | null;
    assigneeId: string | null;
    actorType: NotificationActorType;
    actorId: string;
    previousAssigneeType?: 'user' | 'agent' | 'app' | null;
    previousAssigneeId?: string | null;
  },
): Promise<void> {
  const previousId = args.previousAssigneeId;
  if (
    args.previousAssigneeType === 'user' &&
    previousId != null &&
    !(args.assigneeType === 'user' && args.assigneeId === previousId) &&
    !(args.actorType === 'user' && args.actorId === previousId)
  ) {
    const actorName = await resolveActorName(db, args.actorType, args.actorId);
    await notifyUser(db, {
      userId: previousId,
      organizationId: args.task.organizationId,
      type: 'task_unassigned',
      titleKey: 'taskUnassigned',
      bodyKey: actorName ? 'taskUnassignedByBody' : 'taskUnassignedBody',
      params: {
        title: args.task.title,
        projectId: args.task.projectId,
        ...(actorName ? { actor: actorName } : {}),
      },
      resourceType: 'task',
      resourceId: args.task.id,
      taskId: args.task.id,
      actorType: args.actorType,
      actorId: args.actorId,
      undoes: true,
    });
  }
  if (args.assigneeType !== 'user' || args.assigneeId === null) return;
  await autoSubscribe(db, {
    organizationId: args.task.organizationId,
    taskId: args.task.id,
    subscriberType: 'user',
    subscriberId: args.assigneeId,
    reason: 'assignee',
  });
  if (args.actorType === 'user' && args.actorId === args.assigneeId) return;
  const actorName = await resolveActorName(db, args.actorType, args.actorId);
  await notifyUser(db, {
    userId: args.assigneeId,
    organizationId: args.task.organizationId,
    type: 'task_assigned',
    titleKey: 'taskAssigned',
    bodyKey: actorName ? 'taskAssignedByBody' : 'taskAssignedBody',
    params: {
      title: args.task.title,
      projectId: args.task.projectId,
      ...(actorName ? { actor: actorName } : {}),
    },
    resourceType: 'task',
    resourceId: args.task.id,
    taskId: args.task.id,
    actorType: args.actorType,
    actorId: args.actorId,
  });
}

/**
 * The comment fan-out: the human commenter starts following; mentioned
 * humans are subscribed and get the precedence 'mention' row; other
 * unmuted subscribers get 'task_commented' (skip actor + mentioned).
 */
export async function notifyTaskComment(
  db: Db,
  args: {
    task: TaskFacts;
    commentId: string;
    mentions: Array<{ type: string; id: string }>;
    actorType: NotificationActorType;
    actorId: string;
    notifySubscribers?: boolean;
  },
): Promise<void> {
  if (args.actorType === 'user') {
    await autoSubscribe(db, {
      organizationId: args.task.organizationId,
      taskId: args.task.id,
      subscriberType: 'user',
      subscriberId: args.actorId,
      reason: 'commenter',
    });
  }
  const mentionedUserIds = new Set(
    args.mentions
      .filter((mention) => mention.type === 'user')
      .map((mention) => mention.id),
  );
  const actorName = await resolveActorName(db, args.actorType, args.actorId);
  for (const userId of mentionedUserIds) {
    if (args.actorType === 'user' && userId === args.actorId) continue;
    await autoSubscribe(db, {
      organizationId: args.task.organizationId,
      taskId: args.task.id,
      subscriberType: 'user',
      subscriberId: userId,
      reason: 'mention',
    });
    await notifyUser(db, {
      userId,
      organizationId: args.task.organizationId,
      type: 'mention',
      titleKey: 'mention',
      bodyKey: actorName ? 'mentionByBody' : 'mentionBody',
      params: {
        title: args.task.title,
        projectId: args.task.projectId,
        ...(actorName ? { actor: actorName } : {}),
      },
      resourceType: 'comment',
      resourceId: args.commentId,
      taskId: args.task.id,
      actorType: args.actorType,
      actorId: args.actorId,
    });
  }
  if (args.notifySubscribers === false) return;
  const subscribers = withoutActor(
    await taskSubscriberUserIds(db, args.task.id),
    args.actorType,
    args.actorId,
  );
  for (const userId of subscribers) {
    if (mentionedUserIds.has(userId)) continue;
    await notifyUser(db, {
      userId,
      organizationId: args.task.organizationId,
      type: 'task_commented',
      titleKey: 'taskCommented',
      bodyKey: actorName ? 'taskCommentedByBody' : 'taskCommentedBody',
      params: {
        title: args.task.title,
        projectId: args.task.projectId,
        ...(actorName ? { actor: actorName } : {}),
      },
      resourceType: 'comment',
      resourceId: args.commentId,
      taskId: args.task.id,
      actorType: args.actorType,
      actorId: args.actorId,
    });
  }
}

// ------------------------------------------------------- agent-ask bells

/** Fan-out and scan bounds — the 0.4 caps. */
const MAX_ASK_RECIPIENTS = 500;
const QUESTION_EXCERPT_MAX = 160;

export function questionExcerpt(question: string): string {
  const flat = question.replace(/\s+/g, ' ').trim();
  return flat.length <= QUESTION_EXCERPT_MAX
    ? flat
    : `${flat.slice(0, QUESTION_EXCERPT_MAX)}…`;
}

/** Every user who can SEE the project: admins/owners ∪ the project's team
 * members; an org-wide project (no teams) means every non-disabled member.
 * Falls back to org admins when no project is in scope. */
async function askAudienceUserIds(
  db: Db,
  organizationId: string,
  projectId: string | null,
): Promise<string[]> {
  if (projectId !== null) {
    const projects = await db<
      { teamId: string | null; sharedWithTeamIds: string[] }[]
    >`
      SELECT team_id AS "teamId",
             shared_with_team_ids AS "sharedWithTeamIds"
      FROM app.projects
      WHERE id = ${projectId} AND org_id = ${organizationId}
      LIMIT 1
    `;
    const project = projects[0];
    if (project) {
      const teamIds = [
        ...new Set([
          ...(project.teamId !== null ? [project.teamId] : []),
          ...project.sharedWithTeamIds,
        ]),
      ];
      if (teamIds.length === 0) {
        const rows = await db<{ userId: string }[]>`
          SELECT "userId" FROM "member"
          WHERE "organizationId" = ${organizationId}
            AND "role" <> 'disabled'
          LIMIT ${MAX_ASK_RECIPIENTS}
        `;
        return rows.map((row) => row.userId);
      }
      const rows = await db<{ userId: string }[]>`
        SELECT DISTINCT m."userId" FROM "member" m
        WHERE m."organizationId" = ${organizationId}
          AND m."role" <> 'disabled'
          AND (m."role" IN ('owner', 'admin')
               OR EXISTS (
                 SELECT 1 FROM "teamMember" tm
                 WHERE tm."userId" = m."userId"
                   AND tm."teamId" IN ${db(teamIds)}
               ))
        LIMIT ${MAX_ASK_RECIPIENTS}
      `;
      return rows.map((row) => row.userId);
    }
  }
  const rows = await db<{ userId: string }[]>`
    SELECT "userId" FROM "member"
    WHERE "organizationId" = ${organizationId}
      AND "role" IN ('owner', 'admin')
    LIMIT ${MAX_ASK_RECIPIENTS}
  `;
  return rows.map((row) => row.userId);
}

/**
 * One actionable inbox row per person who can see the project: "the agent
 * paused with a question". Called on ask creation AND on a fold (the merged
 * question is the current truth — the `question` dimension rewrites the
 * unread row in place). Returns the rows written/rewritten.
 */
export async function notifyAgentQuestionAsked(
  db: Db,
  args: {
    organizationId: string;
    askId: string;
    runId: string;
    question: string;
    automationLabel: string;
    task: { id: string; title: string; projectId: string } | null;
    projectId?: string;
  },
): Promise<number> {
  const projectId = args.task?.projectId ?? args.projectId ?? null;
  const recipients = await askAudienceUserIds(
    db,
    args.organizationId,
    projectId,
  );
  const params: Record<string, unknown> = {
    name: args.automationLabel,
    question: questionExcerpt(args.question),
    askId: args.askId,
    runId: args.runId,
    ...(args.task
      ? { title: args.task.title, projectId: args.task.projectId }
      : projectId !== null
        ? { projectId }
        : {}),
  };
  let notified = 0;
  for (const userId of [...new Set(recipients)].slice(0, MAX_ASK_RECIPIENTS)) {
    if (
      !(await isNotificationAllowed(
        db,
        userId,
        args.organizationId,
        'agent_escalation',
      ))
    ) {
      continue;
    }
    await writeCoalescedNotification(db, {
      userId,
      organizationId: args.organizationId,
      type: 'agent_escalation',
      titleKey: 'agentQuestionAsked',
      bodyKey: args.task
        ? 'agentQuestionAskedBody'
        : 'agentQuestionAskedNoTaskBody',
      params,
      resourceType: args.task ? 'task' : 'dashboard',
      resourceId: args.task ? args.task.id : (projectId ?? args.organizationId),
      ...(args.task ? { taskId: args.task.id } : {}),
      actorType: 'agent',
      actorId: args.automationLabel,
    });
    notified += 1;
  }
  return notified;
}

/** The ask is no longer pending — mark every recipient's unread ask row
 * read (one SQL, keyed by the params askId; read rows stay as history). */
export async function dismissAgentQuestionNotifications(
  db: Db,
  args: { organizationId: string; askId: string },
): Promise<number> {
  const rows = await db<{ id: string }[]>`
    UPDATE app.user_notifications SET read = true, read_at_ms = ${Date.now()}
    WHERE org_id = ${args.organizationId} AND type = 'agent_escalation'
      AND read = false AND params ->> 'askId' = ${args.askId}
    RETURNING id
  `;
  return rows.length;
}

// -------------------------------------------------- conversation emitters

/** Cap on a per-team assignment fan-out (the 0.4 bound). */
const MAX_TEAM_ASSIGN_RECIPIENTS = 500;

interface ConversationNotifyFields {
  id: string;
  organizationId: string;
  subject: string | null;
  status: string | null;
}

/** An admin handed the conversation to a member (0.4 semantics: never the
 * self-assigner; body impersonal unless the actor has a display name). */
export async function notifyConversationAssigned(
  db: Db,
  args: {
    conversation: ConversationNotifyFields;
    assigneeUserId: string | null;
    actorType: NotificationActorType;
    actorId: string;
  },
): Promise<void> {
  if (!args.assigneeUserId) return;
  if (args.actorType === 'user' && args.actorId === args.assigneeUserId) {
    return;
  }
  const actorName = await resolveActorName(db, args.actorType, args.actorId);
  await notifyUser(db, {
    userId: args.assigneeUserId,
    organizationId: args.conversation.organizationId,
    type: 'conversation_assigned',
    titleKey: 'conversationAssigned',
    bodyKey: actorName
      ? 'conversationAssignedByBody'
      : 'conversationAssignedBody',
    params: {
      subject: args.conversation.subject ?? '',
      conversationId: args.conversation.id,
      conversationStatus: args.conversation.status ?? 'open',
      ...(actorName ? { actor: actorName } : {}),
    },
    resourceType: 'conversation',
    resourceId: args.conversation.id,
    actorType: args.actorType,
    ...(args.actorId ? { actorId: args.actorId } : {}),
  });
}

/** An admin queued the conversation to a team — fan out to its members
 * (actor excluded, de-duped, bounded), reusing the `conversation_assigned`
 * type with the team-specific body keys. */
export async function notifyConversationAssignedTeam(
  db: Db,
  args: {
    conversation: ConversationNotifyFields;
    teamId: string;
    actorUserId: string | null;
  },
): Promise<void> {
  const actorName = args.actorUserId
    ? await resolveActorName(db, 'user', args.actorUserId)
    : null;
  const members = await db<{ userId: string }[]>`
    SELECT DISTINCT "userId" FROM "teamMember"
    WHERE "teamId" = ${args.teamId}
    LIMIT ${MAX_TEAM_ASSIGN_RECIPIENTS + 1}
  `;
  let notified = 0;
  for (const member of members) {
    if (args.actorUserId && member.userId === args.actorUserId) continue;
    if (notified >= MAX_TEAM_ASSIGN_RECIPIENTS) break;
    notified++;
    await notifyUser(db, {
      userId: member.userId,
      organizationId: args.conversation.organizationId,
      type: 'conversation_assigned',
      titleKey: 'conversationTeamAssigned',
      bodyKey: actorName
        ? 'conversationTeamAssignedByBody'
        : 'conversationTeamAssignedBody',
      params: {
        subject: args.conversation.subject ?? '',
        conversationId: args.conversation.id,
        conversationStatus: args.conversation.status ?? 'open',
        ...(actorName ? { actor: actorName } : {}),
      },
      resourceType: 'conversation',
      resourceId: args.conversation.id,
      actorType: args.actorUserId ? 'user' : 'system',
      ...(args.actorUserId ? { actorId: args.actorUserId } : {}),
    });
  }
}

// ------------------------------------------------------------- attention

/** Cap on every list this summary walks — the badge is a nudge, not a
 * report, and an unbounded count would make the return loop the most
 * expensive query on the page. */
const ATTENTION_LIST_CAP = 100;

export interface AttentionSummary {
  unreadActionableCount: number;
  unreadTotalCount: number;
  waitingOnMeTaskIds: string[];
  pendingReviewCount: number;
}

/**
 * "What needs me back in Tale?" — the 0.4 `getMyAttentionSummary`.
 *
 * Three sources, deliberately different in kind: unread notifications split
 * into actionable vs total (the shared `isActionableNotificationType` decides
 * which, so the badge and the list can never disagree), task reviews waiting
 * on THIS person, and their own open assignments. Reviews and assignments
 * merge into one task-id set because a task that is both should count once.
 */
export async function getMyAttentionSummary(
  sql: Sql,
  args: { organizationId: string; userId: string; projectId?: string },
): Promise<AttentionSummary> {
  const unread = await sql<{ type: string }[]>`
    SELECT type FROM app.user_notifications
    WHERE user_id = ${args.userId} AND org_id = ${args.organizationId}
      AND read = false
    LIMIT ${ATTENTION_LIST_CAP}
  `;
  let unreadActionableCount = 0;
  for (const row of unread) {
    if (isActionableNotificationType(row.type)) unreadActionableCount += 1;
  }

  const waitingOnMe = new Set<string>();
  const reviews = await sql<{ taskId: string; metadata: unknown }[]>`
    SELECT a.resource_id AS "taskId", a.metadata
    FROM app.approvals a
    WHERE a.org_id = ${args.organizationId} AND a.status = 'pending'
      AND a.resource_type = 'task_review'
    LIMIT ${ATTENTION_LIST_CAP}
  `;
  let pendingReviewCount = 0;
  for (const review of reviews) {
    const metadata = review.metadata;
    if (metadata === null || typeof metadata !== 'object') continue;
    if (
      !('requestedFor' in metadata) ||
      metadata.requestedFor !== args.userId
    ) {
      continue;
    }
    const taskId =
      'taskId' in metadata && typeof metadata.taskId === 'string'
        ? metadata.taskId
        : review.taskId;
    if (args.projectId !== undefined) {
      const owned = await sql<{ one: number }[]>`
        SELECT 1 AS one FROM app.tasks
        WHERE id = ${taskId} AND project_id = ${args.projectId} LIMIT 1
      `;
      if (owned.length === 0) continue;
    }
    waitingOnMe.add(taskId);
    pendingReviewCount += 1;
    if (waitingOnMe.size >= ATTENTION_LIST_CAP) break;
  }

  const assigned = await sql<{ id: string }[]>`
    SELECT id FROM app.tasks
    WHERE org_id = ${args.organizationId}
      AND assignee_type = 'user' AND assignee_id = ${args.userId}
      AND archived_at_ms IS NULL
      AND status IN ('todo', 'in_progress', 'in_review')
      AND (${args.projectId ?? null}::text IS NULL
           OR project_id = ${args.projectId ?? null})
    LIMIT ${ATTENTION_LIST_CAP}
  `;
  for (const task of assigned) {
    if (waitingOnMe.size >= ATTENTION_LIST_CAP) break;
    waitingOnMe.add(task.id);
  }

  return {
    unreadActionableCount,
    unreadTotalCount: unread.length,
    waitingOnMeTaskIds: [...waitingOnMe],
    pendingReviewCount,
  };
}
