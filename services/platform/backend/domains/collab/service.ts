import type { Sql, TransactionSql } from 'postgres';

import { isActionableNotificationType } from '../../../lib/shared/attention.ts';
import { NOTIFICATION_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import {
  taskRunFailureClass,
  type TaskRunFailureClass,
} from '../../../lib/shared/task-run-failure.ts';
import {
  coalesceKeyFor,
  NOTIFICATION_EMAIL_DEBOUNCE_MS,
} from '../../core/collab/coalesce.ts';
import { PROJECT_TEAM_IDS_SQL } from '../../core/lib/audience.ts';
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

interface CollabNotificationBase {
  userId: string;
  organizationId: string;
  type: string;
  titleKey: string;
  bodyKey: string;
  resourceType: string;
  resourceId: string;
  actorType: NotificationActorType;
  actorId?: string;
  /** This event UNDOES its dimension (an unassignment after an assignment):
   * when the row it would replace is still unread, both drop. */
  undoes?: boolean;
}

/**
 * A task-bound row must carry its project. Both deep-link builders — the
 * bell's `personalNotificationTarget` and the email's
 * `buildPersonalNotificationUrl` — need `taskId` AND `params.projectId`
 * together to open the task. With only `taskId` the bell row degrades to the
 * org home and the email loses its CTA entirely, silently: no type error, no
 * failing test, and a fallback that reads as deliberate. The two-arm union
 * makes the pair unwritable apart.
 */
export type CollabNotificationInput =
  | (CollabNotificationBase & {
      taskId: string;
      params: Record<string, unknown> & { projectId: string };
    })
  | (CollabNotificationBase & {
      taskId?: undefined;
      params?: Record<string, unknown>;
    });

/** The per-type preference column (the 0.4 PREF_FIELD map). Of the 0.4
 * `automation_alerts` group only `automation_failed` came back (a schedule
 * paused after repeated failures); `budget_alert` / `runtime_offline` have
 * no emitter in 0.5. */
const PREF_FIELD: Record<string, string> = {
  task_assigned: 'task_assigned',
  task_unassigned: 'task_assigned',
  task_status_changed: 'task_status_changed',
  task_commented: 'task_commented',
  mention: 'mention',
  task_deadline: 'task_deadlines',
  task_review_requested: 'task_review',
  task_reviewer_assigned: 'task_review',
  document_review_requested: 'task_review',
  document_review_resolved: 'task_review',
  agent_escalation: 'escalation',
  agent_run_failed: 'escalation',
  automation_failed: 'automation_alerts',
  conversation_message: 'conversation_messages',
  conversation_assigned: 'conversation_messages',
};

/** Tri-state preference resolution: undefined → default ON. The review
 * group ignores any stored value — the settings UI locks it always-on. */
async function isNotificationAllowed(
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

export type CoalesceOutcome =
  | 'inserted'
  | 'rewritten'
  | 'cancelled'
  | 'withheld';

/** The newest UNREAD twin scan bound (the 0.4 cap). */
const UNREAD_SCAN_CAP = 100;

/** The email debounce window (0.4 parity: 60s). Read at call time so the
 * integration harness can shorten it via NOTIFICATION_EMAIL_DEBOUNCE_MS. */
function notificationEmailDebounceMs(): number {
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
 * Tell the recipient's OWN streams that their bell changed. Narrowed to the
 * user — a personal notification row is one person's, so nobody else's
 * client refetches its bell — and named with the entity the app keys both
 * bells on (`NOTIFICATION_HINT_ENTITY`, shared with the frontend). Every
 * write, rewrite, cancel and dismissal of a personal notification routes
 * through here, so the wire name cannot drift per call site again.
 */
export async function emitBellHint(
  db: Db,
  args: { organizationId: string; userId: string },
): Promise<void> {
  await emitHintInTx(db, {
    orgId: args.organizationId,
    userId: args.userId,
    entity: NOTIFICATION_HINT_ENTITY,
    entityId: null,
  });
}

/** One bell hint per distinct recipient of a multi-row dismissal. */
async function emitBellHints(
  db: Db,
  organizationId: string,
  userIds: Iterable<string>,
): Promise<void> {
  for (const userId of new Set(userIds)) {
    await emitBellHint(db, { organizationId, userId });
  }
}

/**
 * Resolve a task-bound row's project when the caller left it out, so the row
 * can still deep-link. The union above requires the pair from typed callers,
 * so this is the belt: this writer is also reached from dynamically built
 * args, and from rows assembled behind a cast.
 *
 * Scoped to the row's own organization — a task id that does not resolve
 * inside it is left alone, so a link is never invented from another tenant's
 * data (from the writer such a row never gets here: nobody in the
 * organization can open its task, so it is withheld first). Only queries on the miss path, and uses the caller's handle, so it
 * joins the open transaction rather than reading around it.
 *
 * `coalesceKeyFor` reads `conversationId` and `documentId`, never
 * `projectId`, so enriching here cannot move a row's collapse identity.
 */
async function withTaskProjectContext(
  db: Db,
  args: CollabNotificationInput,
): Promise<CollabNotificationInput> {
  if (args.taskId === undefined) return args;
  const params: Record<string, unknown> = args.params;
  const supplied = params.projectId;
  if (typeof supplied === 'string' && supplied !== '') return args;
  const rows = await db<{ projectId: string }[]>`
    SELECT project_id AS "projectId" FROM app.tasks
    WHERE id = ${args.taskId} AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  const projectId = rows[0]?.projectId;
  if (projectId === undefined) return args;
  return { ...args, params: { ...params, projectId } };
}

// ------------------------------------------------------- who may be told

/** Which project a reader check is about: one by its id, or the one the task
 * row names when the check runs. */
type ReaderScope = { projectId: string } | { taskId: string };

/**
 * Of `userIds`, those who can open the project now: current, non-disabled
 * members of the organization in its audience — owners and admins always;
 * an organization-wide project, every member; otherwise a member of one of
 * its teams, counted the way `getUserTeamIds` counts them for
 * `assertTaskReadable` (a team of THIS organization). A subscription row
 * outlives its subscriber's membership and team access, an assignee or a
 * reviewer stays on the task row after both are gone, and a run keeps its
 * starter's id — none of them is permission to read about the task, least
 * of all by email. The role is the stored `member` role, which every
 * background delivery reads (a trusted-headers session's role is written
 * back to it at each sign-in).
 */
async function readersAmong(
  db: Db,
  args: { organizationId: string; userIds: readonly string[] } & ReaderScope,
): Promise<string[]> {
  const userIds = [...new Set(args.userIds)];
  if (userIds.length === 0) return [];
  const projectId = 'projectId' in args ? args.projectId : null;
  const taskId = 'taskId' in args ? args.taskId : null;
  const rows = await db<{ userId: string }[]>`
    WITH audience AS (
      SELECT ${db.unsafe(PROJECT_TEAM_IDS_SQL)} AS "teamIds"
      FROM app.projects
      WHERE org_id = ${args.organizationId}
        AND id = COALESCE(${projectId}::text, (
          SELECT project_id FROM app.tasks
          WHERE id = ${taskId}::text AND org_id = ${args.organizationId}
        ))
      LIMIT 1
    )
    SELECT m."userId" FROM audience, "member" m
    WHERE m."organizationId" = ${args.organizationId}
      AND m."userId" IN ${db(userIds)}
      AND lower(m."role") <> 'disabled'
      AND (lower(m."role") IN ('owner', 'admin')
           OR cardinality(audience."teamIds") = 0
           OR EXISTS (
             SELECT 1 FROM "teamMember" tm
             JOIN "team" t ON t."id" = tm."teamId"
             WHERE tm."userId" = m."userId"
               AND t."organizationId" = ${args.organizationId}
               AND tm."teamId" = ANY (audience."teamIds")
           ))
  `;
  return rows.map((row) => row.userId);
}

/** {@link readersAmong} for a project named by its id. */
function projectReadersAmong(
  db: Db,
  args: { organizationId: string; projectId: string; userIds: string[] },
): Promise<string[]> {
  return readersAmong(db, args);
}

/**
 * {@link readersAmong} for the project a task is filed in now — the gate
 * every task-bound row passes when it is written
 * ({@link writeCoalescedNotification}), and again when its email leaves
 * (`email-sink.ts`).
 */
export function taskReadersAmong(
  db: Db,
  args: { organizationId: string; taskId: string; userIds: readonly string[] },
): Promise<string[]> {
  return readersAmong(db, args);
}

/**
 * Write (or rewrite, or cancel) one notification row. Callers own the
 * preference gate — this is the mechanics of one row.
 *
 * A task-bound row is news about the task, so it is written only for
 * someone who can open the task now ({@link taskReadersAmong}): whoever
 * picked the recipient — a subscription, the task's assignee or reviewer, a
 * mention, a date sweep — for anyone else nothing is written, rewritten or
 * cancelled, and the answer is `withheld` (#3631).
 */
export async function writeCoalescedNotification(
  db: Db,
  input: CollabNotificationInput,
): Promise<CoalesceOutcome> {
  if (
    input.taskId !== undefined &&
    (
      await taskReadersAmong(db, {
        organizationId: input.organizationId,
        taskId: input.taskId,
        userIds: [input.userId],
      })
    ).length === 0
  ) {
    return 'withheld';
  }
  const args = await withTaskProjectContext(db, input);
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
    await emitBellHint(db, {
      organizationId: args.organizationId,
      userId: args.userId,
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
    await emitBellHint(db, {
      organizationId: args.organizationId,
      userId: args.userId,
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
  await emitBellHint(db, {
    organizationId: args.organizationId,
    userId: args.userId,
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
  if (rows.length > 0) {
    // The reader's OTHER tabs and devices drop the badge too.
    await emitBellHint(sql, {
      organizationId: args.organizationId,
      userId: args.userId,
    });
  }
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
  if (rows.length > 0) {
    await emitBellHint(sql, { organizationId, userId });
  }
  return rows.length;
}

// ------------------------------------------------------------ subscriptions

/** Idempotent task subscription upsert: a subscription the task already has
 * is kept as it is, mute included. */
export async function autoSubscribe(
  db: Db,
  args: {
    organizationId: string;
    taskId: string;
    subscriberType: 'user' | 'agent';
    subscriberId: string;
    reason: string;
    /** A watcher carried over from another task keeps the mute it had
     * there; absent is the system default (not muted). */
    muted?: boolean | null;
  },
): Promise<void> {
  await db`
    INSERT INTO app.task_subscriptions (
      org_id, task_id, subscriber_type, subscriber_id, reason, muted,
      created_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.taskId}, ${args.subscriberType},
      ${args.subscriberId}, ${args.reason}, ${args.muted ?? null}, ${Date.now()}
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

/** Unmuted human watchers of a task — the audience for outcomes. Which of
 * them may still be told is the writer's call: a watcher who lost access to
 * the project keeps the subscription and gets no row
 * ({@link writeCoalescedNotification}). */
async function taskSubscriberUserIds(
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
  // The UI sends one switch per request. NULL marks an omitted field; merge
  // it inside the upsert so concurrent switches cannot replace one another.
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
      task_assigned = COALESCE(EXCLUDED.task_assigned, app.notification_preferences.task_assigned),
      task_status_changed = COALESCE(EXCLUDED.task_status_changed, app.notification_preferences.task_status_changed),
      task_commented = COALESCE(EXCLUDED.task_commented, app.notification_preferences.task_commented),
      mention = COALESCE(EXCLUDED.mention, app.notification_preferences.mention),
      task_deadlines = COALESCE(EXCLUDED.task_deadlines, app.notification_preferences.task_deadlines),
      task_review = COALESCE(EXCLUDED.task_review, app.notification_preferences.task_review),
      escalation = COALESCE(EXCLUDED.escalation, app.notification_preferences.escalation),
      automation_alerts = COALESCE(EXCLUDED.automation_alerts, app.notification_preferences.automation_alerts),
      conversation_messages = COALESCE(EXCLUDED.conversation_messages, app.notification_preferences.conversation_messages),
      actionable_email = COALESCE(EXCLUDED.actionable_email, app.notification_preferences.actionable_email),
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

/** Who asks for the review. `system` is a hand-over no person made (an
 * erasure moving a review off its subject): the request reads impersonally. */
export type TaskReviewSubmitter =
  | { kind: 'agent'; name?: string }
  | { kind: 'user'; userId: string }
  | { kind: 'system' };

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
      : args.submitter.kind === 'system'
        ? { actorType: 'system' as const }
        : {
            actorType: 'agent' as const,
            ...(agentName !== undefined ? { actorId: agentName } : {}),
          }),
  });
}

/**
 * Heads-up to a freshly designated reviewer while the work is still in
 * flight — "you're on the hook for this one". Bell only: the review is not
 * due yet, so the type stays out of `ACTIONABLE_NOTIFICATION_TYPES` (no
 * email); the actionable request + email follow when the task reaches
 * `in_review`. Skips the preference gate like the request (the review group
 * is locked on) and never pings a person about designating themselves. The
 * 0.4 emitter existed only in the dead Convex shim — this is the live one.
 */
export async function notifyTaskReviewerAssigned(
  db: Db,
  args: {
    organizationId: string;
    task: { id: string; projectId: string; title: string };
    reviewerUserId: string;
    actorUserId: string;
  },
): Promise<void> {
  if (args.reviewerUserId === args.actorUserId) return;
  const actorName = await resolveUserDisplayName(db, args.actorUserId);
  await writeCoalescedNotification(db, {
    userId: args.reviewerUserId,
    organizationId: args.organizationId,
    type: 'task_reviewer_assigned',
    titleKey: 'taskReviewerAssigned',
    bodyKey: actorName
      ? 'taskReviewerAssignedByBody'
      : 'taskReviewerAssignedBody',
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
    actorId: args.actorUserId,
  });
}

/** Mark this approval's unread request bells read — the review was decided
 * or superseded; the bell must stop ringing. Matches only THIS approval. */
export async function dismissReviewRequestNotifications(
  db: Db,
  args: { organizationId: string; approvalId: string },
): Promise<number> {
  const rows = await db<{ id: string; userId: string }[]>`
    UPDATE app.user_notifications SET read = true, read_at_ms = ${Date.now()}
    WHERE org_id = ${args.organizationId}
      AND type = 'task_review_requested' AND read = false
      AND (resource_id = ${args.approvalId}
           OR params ->> 'approvalId' = ${args.approvalId})
    RETURNING id, user_id AS "userId"
  `;
  // The reviewer did not act here (the decision or a supersede did) — the
  // hint is the only way their bell stops ringing without a reload.
  await emitBellHints(
    db,
    args.organizationId,
    rows.map((row) => row.userId),
  );
  return rows.length;
}

/**
 * Mark a former designee's unread "You're the reviewer" heads-up on this
 * task read — the designation moved off them before the review opened, so
 * the bell must stop telling them they are on the hook. Only the heads-up:
 * a request the open review sent them is `dismissReviewRequestNotifications`'
 * (per approval), and a read row is history and stays as it is.
 */
export async function dismissReviewerAssignedNotifications(
  db: Db,
  args: { organizationId: string; taskId: string; userId: string },
): Promise<number> {
  const rows = await db<{ id: string }[]>`
    UPDATE app.user_notifications SET read = true, read_at_ms = ${Date.now()}
    WHERE org_id = ${args.organizationId} AND user_id = ${args.userId}
      AND type = 'task_reviewer_assigned' AND read = false
      AND task_id = ${args.taskId}
    RETURNING id
  `;
  if (rows.length > 0) {
    await emitBellHint(db, {
      organizationId: args.organizationId,
      userId: args.userId,
    });
  }
  return rows.length;
}

/**
 * Mark the owner's unread cloud-sync failure rows for one config read — the
 * run that recovered did what the row asked for, so the bell stops ringing
 * without a click (`domains/onedrive/sync-health.ts`). Matches only THIS
 * config; a second broken sync keeps its own row.
 */
export async function dismissCloudSyncFailureNotifications(
  db: Db,
  args: { organizationId: string; userId: string; configId: string },
): Promise<number> {
  const rows = await db<{ id: string }[]>`
    UPDATE app.user_notifications SET read = true, read_at_ms = ${Date.now()}
    WHERE org_id = ${args.organizationId} AND user_id = ${args.userId}
      AND type = 'cloud_sync_failed' AND read = false
      AND resource_id = ${args.configId}
    RETURNING id
  `;
  if (rows.length > 0) {
    await emitBellHint(db, {
      organizationId: args.organizationId,
      userId: args.userId,
    });
  }
  return rows.length;
}

/**
 * Tell the organization's owners and admins that a schedule paused itself
 * after repeated permanent failures (`automations/trigger-failures.ts`):
 * one actionable row each, written in the pausing transaction and gated by
 * their `automation_alerts` preference. Only they can fix an automation and
 * turn its trigger back on; the row opens the automation's General tab,
 * where the Trigger section shows the pause and the last failure.
 */
export async function notifyTriggerPaused(
  db: Db,
  args: {
    organizationId: string;
    triggerId: string;
    name: string;
    failures: number;
    code: string;
  },
): Promise<number> {
  const recipients = await db<{ userId: string }[]>`
    SELECT "userId" FROM "member"
    WHERE "organizationId" = ${args.organizationId}
      AND lower("role") IN ('owner', 'admin')
  `;
  for (const recipient of recipients) {
    await notifyUser(db, {
      userId: recipient.userId,
      organizationId: args.organizationId,
      type: 'automation_failed',
      titleKey: 'automationTriggerPaused',
      bodyKey: 'automationTriggerPausedBody',
      params: {
        name: args.name,
        failures: args.failures,
        code: args.code,
        trigger: true,
      },
      resourceType: 'automation_trigger',
      resourceId: args.triggerId,
      actorType: 'system',
    });
  }
  return recipients.length;
}

/**
 * Mark every unread paused-schedule row of one trigger read — someone saved
 * or removed the trigger, which is what the row asked of all its recipients,
 * so the other admins' bells stop ringing too. Matches only THIS trigger.
 */
export async function dismissTriggerPausedNotifications(
  db: Db,
  args: { organizationId: string; triggerId: string },
): Promise<number> {
  const rows = await db<{ userId: string }[]>`
    UPDATE app.user_notifications SET read = true, read_at_ms = ${Date.now()}
    WHERE org_id = ${args.organizationId}
      AND type = 'automation_failed' AND read = false
      AND resource_id = ${args.triggerId}
    RETURNING user_id AS "userId"
  `;
  await emitBellHints(
    db,
    args.organizationId,
    rows.map((row) => row.userId),
  );
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

/** The humans a mention list names, each once. */
function mentionedUserIdsOf(
  mentions: Array<{ type: string; id: string }>,
): Set<string> {
  return new Set(
    mentions
      .filter((mention) => mention.type === 'user')
      .map((mention) => mention.id),
  );
}

/**
 * The mention bell, one surface's worth: every named human except the actor
 * starts following the task and gets the precedence 'mention' row, which
 * points at the text that named them (a comment, or the task itself for its
 * description).
 */
async function notifyMentionedUsers(
  db: Db,
  args: {
    task: TaskFacts;
    userIds: Iterable<string>;
    resource: { type: 'comment' | 'task'; id: string };
    actorType: NotificationActorType;
    actorId: string;
    actorName: string | null;
  },
): Promise<void> {
  for (const userId of args.userIds) {
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
      bodyKey: args.actorName ? 'mentionByBody' : 'mentionBody',
      params: {
        title: args.task.title,
        projectId: args.task.projectId,
        ...(args.actorName ? { actor: args.actorName } : {}),
      },
      resourceType: args.resource.type,
      resourceId: args.resource.id,
      taskId: args.task.id,
      actorType: args.actorType,
      actorId: args.actorId,
    });
  }
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
  const mentionedUserIds = mentionedUserIdsOf(args.mentions);
  const actorName = await resolveActorName(db, args.actorType, args.actorId);
  await notifyMentionedUsers(db, {
    task: args.task,
    userIds: mentionedUserIds,
    resource: { type: 'comment', id: args.commentId },
    actorType: args.actorType,
    actorId: args.actorId,
    actorName,
  });
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

/**
 * The mention fan-out for the task's DESCRIPTION — the mention half of
 * {@link notifyTaskComment} for `@`s typed into the description (the 0.4
 * `notifyTaskMentions`). The row points at the task, since no comment carries
 * the mention. Callers pass only the mentions a write NEWLY introduced, so an
 * unrelated description edit never re-notifies everyone already named, and
 * watchers are not told: a description edit is not a new comment.
 */
export async function notifyTaskMentions(
  db: Db,
  args: {
    task: TaskFacts;
    mentions: Array<{ type: string; id: string }>;
    actorType: NotificationActorType;
    actorId: string;
  },
): Promise<void> {
  const mentionedUserIds = mentionedUserIdsOf(args.mentions);
  if (mentionedUserIds.size === 0) return;
  await notifyMentionedUsers(db, {
    task: args.task,
    userIds: mentionedUserIds,
    resource: { type: 'task', id: args.task.id },
    actorType: args.actorType,
    actorId: args.actorId,
    actorName: await resolveActorName(db, args.actorType, args.actorId),
  });
}

// ---------------------------------------------------- agent-run failures

/** The `inbox` body a failed run is announced with, by who can act on it
 * (`lib/shared/task-run-failure.ts`). A spent usage limit waits on an admin
 * and a broken setup on a project editor, so those two say so; every other
 * failure is the reader's to start again, and the task says what happened. */
const AGENT_RUN_FAILED_BODY_KEY: Record<TaskRunFailureClass, string> = {
  budget: 'agentRunFailedBudgetBody',
  setup: 'agentRunFailedSetupBody',
  time_limit: 'agentRunFailedBody',
  capacity: 'agentRunFailedBody',
  model: 'agentRunFailedBody',
  start: 'agentRunFailedBody',
  interrupted: 'agentRunFailedBody',
  unknown: 'agentRunFailedBody',
};

/**
 * A project agent's run on a task failed and nothing will start it again by
 * itself — the automatic retries are spent, or the failure is one a retry
 * cannot change. Until this row existed the only trace was the run strip
 * inside the task: whoever started the agent and went back to their chat
 * was never told, and the task sat at In progress with nothing working on
 * it.
 *
 * Told: the person who started the run, and the task's unmuted watchers —
 * those of them who can still open the project. Gated by the `escalation`
 * preference (an agent needs a human) and actionable, so it leaves the app
 * as an email. One row per task — a later failure on the same task
 * rewrites the unread one.
 */
export async function notifyAgentRunFailed(
  db: Db,
  args: {
    task: TaskFacts;
    agentId: string;
    /** The person who started the run; null when a schedule did. */
    starterUserId: string | null;
    failureCode: string | null;
  },
): Promise<number> {
  const candidates = new Set(await taskSubscriberUserIds(db, args.task.id));
  if (args.starterUserId !== null) candidates.add(args.starterUserId);
  const recipients = await projectReadersAmong(db, {
    organizationId: args.task.organizationId,
    projectId: args.task.projectId,
    userIds: [...candidates],
  });
  const bodyKey =
    AGENT_RUN_FAILED_BODY_KEY[taskRunFailureClass(args.failureCode)];
  for (const userId of recipients) {
    await notifyUser(db, {
      userId,
      organizationId: args.task.organizationId,
      type: 'agent_run_failed',
      titleKey: 'agentRunFailed',
      bodyKey,
      params: { title: args.task.title, projectId: args.task.projectId },
      resourceType: 'task',
      resourceId: args.task.id,
      taskId: args.task.id,
      actorType: 'agent',
      actorId: args.agentId,
    });
  }
  return recipients.length;
}

/**
 * Mark a task's unread failed-run rows read — a new run started on it, which
 * is what the row asked for, so the bell stops ringing for everyone it rang
 * for. Read rows stay as history.
 */
export async function dismissAgentRunFailedNotifications(
  db: Db,
  args: { organizationId: string; taskId: string },
): Promise<number> {
  const rows = await db<{ userId: string }[]>`
    UPDATE app.user_notifications SET read = true, read_at_ms = ${Date.now()}
    WHERE org_id = ${args.organizationId} AND type = 'agent_run_failed'
      AND read = false AND task_id = ${args.taskId}
    RETURNING user_id AS "userId"
  `;
  await emitBellHints(
    db,
    args.organizationId,
    rows.map((row) => row.userId),
  );
  return rows.length;
}

// ------------------------------------------------------- agent-ask bells

/** Fan-out and scan bounds — the 0.4 caps. */
const MAX_ASK_RECIPIENTS = 500;
const QUESTION_EXCERPT_MAX = 160;

function questionExcerpt(question: string): string {
  const flat = question.replace(/\s+/g, ' ').trim();
  return flat.length <= QUESTION_EXCERPT_MAX
    ? flat
    : `${flat.slice(0, QUESTION_EXCERPT_MAX)}…`;
}

/** Every user who can SEE the project: admins/owners ∪ the project's team
 * members; an org-wide project (no teams) means every non-disabled member.
 * A question with no task is answered only on its run page, which only
 * Owners, Admins and Developers may open (`isAdminOrDeveloperRole`), so then
 * only they are asked — a task-bound one is answered on the task. Falls back
 * to org admins when no project is in scope. */
async function askAudienceUserIds(
  db: Db,
  organizationId: string,
  projectId: string | null,
  answeredOnTask: boolean,
): Promise<string[]> {
  if (projectId !== null) {
    const projects = await db<{ teamIds: string[] | null }[]>`
      SELECT ${db.unsafe(PROJECT_TEAM_IDS_SQL)} AS "teamIds"
      FROM app.projects
      WHERE id = ${projectId} AND org_id = ${organizationId}
      LIMIT 1
    `;
    const project = projects[0];
    if (project) {
      const teamIds = project.teamIds ?? [];
      if (teamIds.length === 0) {
        const rows = await db<{ userId: string }[]>`
          SELECT "userId" FROM "member"
          WHERE "organizationId" = ${organizationId}
            AND "role" <> 'disabled'
            AND (${answeredOnTask}
                 OR "role" IN ('owner', 'admin', 'developer'))
          LIMIT ${MAX_ASK_RECIPIENTS}
        `;
        return rows.map((row) => row.userId);
      }
      const rows = await db<{ userId: string }[]>`
        SELECT DISTINCT m."userId" FROM "member" m
        WHERE m."organizationId" = ${organizationId}
          AND m."role" <> 'disabled'
          AND (${answeredOnTask}
               OR m."role" IN ('owner', 'admin', 'developer'))
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
 * One actionable inbox row per person who can see the project and answer
 * the question there (see `askAudienceUserIds`): "the agent paused with a
 * question". Called on ask creation AND on a fold (the merged
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
    args.task !== null,
  );
  const shared = {
    name: args.automationLabel,
    question: questionExcerpt(args.question),
    askId: args.askId,
    runId: args.runId,
  };
  // Two explicit arms rather than one widened bag: a task-bound row has to
  // carry its project, and `CollabNotificationInput` will not accept a
  // spread that TypeScript cannot narrow to that pair.
  const row = args.task
    ? ({
        bodyKey: 'agentQuestionAskedBody',
        params: {
          ...shared,
          title: args.task.title,
          projectId: args.task.projectId,
        },
        resourceType: 'task',
        resourceId: args.task.id,
        taskId: args.task.id,
      } as const)
    : ({
        bodyKey: 'agentQuestionAskedNoTaskBody',
        params: projectId !== null ? { ...shared, projectId } : { ...shared },
        resourceType: 'dashboard',
        resourceId: projectId ?? args.organizationId,
      } as const);
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
    const outcome = await writeCoalescedNotification(db, {
      ...row,
      userId,
      organizationId: args.organizationId,
      type: 'agent_escalation',
      titleKey: 'agentQuestionAsked',
      actorType: 'agent',
      actorId: args.automationLabel,
    });
    if (outcome !== 'withheld') notified += 1;
  }
  return notified;
}

/** The ask is no longer pending — mark every recipient's unread ask row
 * read (one SQL, keyed by the params askId; read rows stay as history). */
export async function dismissAgentQuestionNotifications(
  db: Db,
  args: { organizationId: string; askId: string },
): Promise<number> {
  const rows = await db<{ id: string; userId: string }[]>`
    UPDATE app.user_notifications SET read = true, read_at_ms = ${Date.now()}
    WHERE org_id = ${args.organizationId} AND type = 'agent_escalation'
      AND read = false AND params ->> 'askId' = ${args.askId}
    RETURNING id, user_id AS "userId"
  `;
  await emitBellHints(
    db,
    args.organizationId,
    rows.map((row) => row.userId),
  );
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
