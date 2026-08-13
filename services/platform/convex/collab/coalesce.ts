/**
 * ONE write path for personal notifications, with collapse.
 *
 * A person cares about the CURRENT state of a thing, not about every keystroke
 * that produced it. Assigning someone, unassigning them, and assigning them
 * again used to write three bell rows and schedule three emails; the first two
 * were obsolete before they were read. So every row that describes a state (who
 * owns it, who reviews it, where it stands, when it's due) carries a
 * `coalesceKey` — `<resourceKind>:<resourceId>:<dimension>` — and while a row
 * with that key is UNREAD a later event on the same dimension REWRITES it in
 * place. Content-bearing rows (a comment, a mention) never collapse: each says
 * something different, and collapsing would lose it.
 *
 * The email rides the same rule. It is scheduled with a short delay instead of
 * `runAfter(0)`, and a rewrite cancels the pending job before scheduling the
 * next one — so a flurry inside the window sends at most one email, and that
 * email renders from the row as it stands when it finally fires (see
 * `notifications/email_notification.ts`). An event that UNDOES an unread one
 * (unassigned right after assigned) deletes the row and cancels the job: the
 * person was never told, and there is now nothing true left to tell them.
 *
 * Read rows are never touched — once someone has seen a notification it is part
 * of their history, so the next event starts a fresh row.
 */

import type { Infer } from 'convex/values';

import { isActionableNotificationType } from '../../lib/shared/attention';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { notificationTypeValidator } from './schema';

type NotificationType = Infer<typeof notificationTypeValidator>;
type ResourceType = Doc<'userNotifications'>['resourceType'];

/**
 * How long a notification's email waits for a better version of itself. Long
 * enough to swallow a burst of edits (a picker fiddled with, a drag undone),
 * short enough that a review request still lands while the reviewer is at their
 * desk.
 */
export const NOTIFICATION_EMAIL_DEBOUNCE_MS = 60_000;

/** How far back the collapse looks for its unread twin. Matches the scan bound
 *  the automation dedupe already used, so the read cost is unchanged. */
const UNREAD_SCAN_CAP = 100;

/**
 * The state a notification type talks about. Types sharing a dimension for the
 * same resource are versions of one another; types with no dimension are events
 * that stand alone.
 */
const DIMENSION: Partial<Record<NotificationType, string>> = {
  // Who owns the work.
  task_assigned: 'assignment',
  task_unassigned: 'assignment',
  conversation_assigned: 'assignment',
  // Who the gate waits on, and whether it is open.
  task_review_requested: 'review',
  task_review_resolved: 'review',
  task_reviewer_assigned: 'review',
  document_review_requested: 'review',
  document_review_resolved: 'review',
  // Where the work stands.
  task_status_changed: 'status',
  // When it is due.
  task_deadline: 'deadline',
  // Deliberately absent — each carries its own content, so each is its own row:
  // mention, task_commented, conversation_message, agent_escalation,
  // automation_failed, budget_alert, runtime_offline.
};

/**
 * The collapse identity for one notification, or null when this type must never
 * collapse. Keyed on the RESOURCE the state belongs to (a task, a conversation,
 * a document), not on the row's deep-link target: a review request points at its
 * approval and the resolution at the task, yet both describe one gate.
 */
export function coalesceKeyFor(args: {
  type: NotificationType;
  resourceType: ResourceType;
  resourceId: string;
  taskId?: Id<'tasks'>;
  params?: Record<string, unknown>;
}): string | null {
  const dimension = DIMENSION[args.type];
  if (dimension === undefined) return null;
  const subject = coalesceSubject(args);
  return subject === null ? null : `${subject}:${dimension}`;
}

/** `<kind>:<id>` of the thing whose state this notification describes. */
function coalesceSubject(args: {
  resourceType: ResourceType;
  resourceId: string;
  taskId?: Id<'tasks'>;
  params?: Record<string, unknown>;
}): string | null {
  if (args.taskId !== undefined) return `task:${String(args.taskId)}`;
  if (args.resourceType === 'task') return `task:${args.resourceId}`;
  const conversationId = args.params?.conversationId;
  if (typeof conversationId === 'string') {
    return `conversation:${conversationId}`;
  }
  if (args.resourceType === 'conversation') {
    return `conversation:${args.resourceId}`;
  }
  const documentId = args.params?.documentId;
  if (typeof documentId === 'string') return `document:${documentId}`;
  if (args.resourceType === 'document') return `document:${args.resourceId}`;
  // A dimension we can't tie to a subject would collapse unrelated rows
  // together, so it collapses nothing instead.
  return null;
}

export interface CoalescedNotification {
  userId: string;
  organizationId: string;
  type: NotificationType;
  titleKey: string;
  bodyKey: string;
  params?: Record<string, unknown>;
  resourceType: ResourceType;
  resourceId: string;
  taskId?: Id<'tasks'>;
  actorType: 'user' | 'agent' | 'system';
  actorId?: string;
  /**
   * This event UNDOES its dimension rather than updating it (an unassignment
   * after an assignment). If the row it would replace is still unread, both are
   * dropped: nobody was told, so there is nothing to correct.
   */
  undoes?: boolean;
}

export type CoalesceOutcome =
  | { kind: 'inserted'; notificationId: Id<'userNotifications'> }
  | { kind: 'rewritten'; notificationId: Id<'userNotifications'> }
  | { kind: 'cancelled' };

/**
 * Write (or rewrite, or cancel) one notification and (re)schedule its email.
 * Callers own the preference gate — this is the mechanics of one row, not the
 * decision to notify.
 */
export async function writeCoalescedNotification(
  ctx: MutationCtx,
  args: CoalescedNotification,
): Promise<CoalesceOutcome> {
  const key = coalesceKeyFor(args);
  const existing = key === null ? null : await findUnreadTwin(ctx, args, key);

  if (existing !== null && args.undoes === true) {
    await cancelEmail(ctx, existing.emailJobId);
    await ctx.db.delete(existing._id);
    return { kind: 'cancelled' };
  }

  const row = {
    userId: args.userId,
    organizationId: args.organizationId,
    type: args.type,
    titleKey: args.titleKey,
    bodyKey: args.bodyKey,
    params: args.params,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    taskId: args.taskId,
    actorType: args.actorType,
    actorId: args.actorId,
    read: false,
    createdAt: Date.now(),
    ...(key !== null ? { coalesceKey: key } : {}),
  };

  if (existing !== null) {
    // Rewrite in place: same row, current truth, and the pending email is
    // replaced rather than joined by a second one. `createdAt` moves so the
    // bell re-sorts to the top — this IS news, just not a second item.
    await cancelEmail(ctx, existing.emailJobId);
    await ctx.db.patch(existing._id, { ...row, emailJobId: undefined });
    await scheduleEmail(ctx, existing._id, args);
    return { kind: 'rewritten', notificationId: existing._id };
  }

  const notificationId = await ctx.db.insert('userNotifications', row);
  await scheduleEmail(ctx, notificationId, args);
  return { kind: 'inserted', notificationId };
}

/** The newest UNREAD row for this recipient sharing the collapse key. */
async function findUnreadTwin(
  ctx: MutationCtx,
  args: Pick<CoalescedNotification, 'userId' | 'organizationId'>,
  key: string,
): Promise<Doc<'userNotifications'> | null> {
  const recent = await ctx.db
    .query('userNotifications')
    .withIndex('by_user_org_read', (q) =>
      q
        .eq('userId', args.userId)
        .eq('organizationId', args.organizationId)
        .eq('read', false),
    )
    .order('desc')
    .take(UNREAD_SCAN_CAP);
  return recent.find((row) => row.coalesceKey === key) ?? null;
}

/**
 * Hand the row to the email sink after the debounce window, and remember the
 * job so a rewrite can cancel it. Non-actionable types never email, so they get
 * no job at all.
 */
async function scheduleEmail(
  ctx: MutationCtx,
  notificationId: Id<'userNotifications'>,
  args: CoalescedNotification,
): Promise<void> {
  if (!isActionableNotificationType(args.type)) return;
  const emailJobId = await ctx.scheduler.runAfter(
    NOTIFICATION_EMAIL_DEBOUNCE_MS,
    internal.notifications.email_notification.deliverActionableEmailAction,
    { notificationId },
  );
  await ctx.db.patch(notificationId, { emailJobId });
}

/** Cancelling an already-run job is a documented no-op, so this needs no guard
 *  beyond "was one scheduled". */
async function cancelEmail(
  ctx: MutationCtx,
  emailJobId: Id<'_scheduled_functions'> | undefined,
): Promise<void> {
  if (emailJobId === undefined) return;
  await ctx.scheduler.cancel(emailJobId);
}
