/**
 * Content-notification fan-out for tasks. These helpers run INSIDE the task
 * mutations (transactional with the write), distinct from `emitEvent` (which is
 * the fire-and-forget transport for the automation engine). One `userNotifications`
 * row is written per recipient; the actor is never notified of their own action.
 */

import type { Infer } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type {
  notificationTypeValidator,
  subscriptionReasonValidator,
} from './schema';

type NotificationType = Infer<typeof notificationTypeValidator>;
type SubscriptionReason = Infer<typeof subscriptionReasonValidator>;
type ActorType = 'user' | 'agent';

const PREF_FIELD: Record<
  NotificationType,
  'taskAssigned' | 'taskStatusChanged' | 'taskCommented' | 'mention'
> = {
  task_assigned: 'taskAssigned',
  task_status_changed: 'taskStatusChanged',
  task_commented: 'taskCommented',
  mention: 'mention',
};

/** Tri-state preference resolution: undefined → default ON. */
async function isAllowed(
  ctx: MutationCtx,
  userId: string,
  organizationId: string,
  type: NotificationType,
): Promise<boolean> {
  const prefs = await ctx.db
    .query('notificationPreferences')
    .withIndex('by_userId_organizationId', (q) =>
      q.eq('userId', userId).eq('organizationId', organizationId),
    )
    .first();
  if (!prefs) return true;
  const value = prefs[PREF_FIELD[type]];
  return value === undefined ? true : value;
}

/** Idempotent task subscription upsert. */
export async function autoSubscribe(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    subscriberType: ActorType;
    subscriberId: string;
    reason: SubscriptionReason;
  },
): Promise<void> {
  const existing = await ctx.db
    .query('taskSubscriptions')
    .withIndex('by_task_subscriber', (q) =>
      q
        .eq('taskId', args.task._id)
        .eq('subscriberType', args.subscriberType)
        .eq('subscriberId', args.subscriberId),
    )
    .first();
  if (existing) return;
  await ctx.db.insert('taskSubscriptions', {
    organizationId: args.task.organizationId,
    taskId: args.task._id,
    subscriberType: args.subscriberType,
    subscriberId: args.subscriberId,
    reason: args.reason,
    createdAt: Date.now(),
  });
}

async function writeNotification(
  ctx: MutationCtx,
  args: {
    userId: string;
    organizationId: string;
    type: NotificationType;
    titleKey: string;
    bodyKey: string;
    params?: Record<string, unknown>;
    resourceType: 'task' | 'comment' | 'thread';
    resourceId: string;
    taskId?: Id<'tasks'>;
    actorType: 'user' | 'agent' | 'system';
    actorId?: string;
  },
): Promise<void> {
  if (!(await isAllowed(ctx, args.userId, args.organizationId, args.type))) {
    return;
  }
  await ctx.db.insert('userNotifications', {
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
  });
}

/** User subscriber ids for a task (not muted). */
async function taskSubscriberUserIds(
  ctx: MutationCtx,
  taskId: Id<'tasks'>,
): Promise<string[]> {
  const ids: string[] = [];
  for await (const sub of ctx.db
    .query('taskSubscriptions')
    .withIndex('by_task', (q) => q.eq('taskId', taskId))) {
    if (sub.subscriberType === 'user' && !sub.muted) {
      ids.push(sub.subscriberId);
    }
  }
  return ids;
}

/** Exclude the actor (only when the actor is a human). */
function withoutActor(
  ids: Iterable<string>,
  actorType: ActorType,
  actorId: string,
): string[] {
  const set = new Set(ids);
  if (actorType === 'user') set.delete(actorId);
  return [...set];
}

export async function notifyTaskStatusChanged(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    fromStatus: string;
    toStatus: string;
    actorType: ActorType;
    actorId: string;
  },
): Promise<void> {
  const recipients = withoutActor(
    await taskSubscriberUserIds(ctx, args.task._id),
    args.actorType,
    args.actorId,
  );
  for (const userId of recipients) {
    await writeNotification(ctx, {
      userId,
      organizationId: args.task.organizationId,
      type: 'task_status_changed',
      titleKey: 'taskStatusChanged',
      bodyKey: 'taskStatusChangedBody',
      params: {
        title: args.task.title,
        from: args.fromStatus,
        to: args.toStatus,
      },
      resourceType: 'task',
      resourceId: String(args.task._id),
      taskId: args.task._id,
      actorType: args.actorType,
      actorId: args.actorId,
    });
  }
}

export async function notifyTaskAssigned(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    assigneeType: ActorType | null;
    assigneeId: string | null;
    actorType: ActorType;
    actorId: string;
  },
): Promise<void> {
  if (args.assigneeType !== 'user' || !args.assigneeId) return;
  await autoSubscribe(ctx, {
    task: args.task,
    subscriberType: 'user',
    subscriberId: args.assigneeId,
    reason: 'assignee',
  });
  // Don't notify someone who assigned the task to themselves.
  if (args.actorType === 'user' && args.actorId === args.assigneeId) return;
  await writeNotification(ctx, {
    userId: args.assigneeId,
    organizationId: args.task.organizationId,
    type: 'task_assigned',
    titleKey: 'taskAssigned',
    bodyKey: 'taskAssignedBody',
    params: { title: args.task.title },
    resourceType: 'task',
    resourceId: String(args.task._id),
    taskId: args.task._id,
    actorType: args.actorType,
    actorId: args.actorId,
  });
}

export async function notifyTaskComment(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    commentId: Id<'taskComments'>;
    mentions: Array<{ type: 'user' | 'agent'; id: string }>;
    actorType: ActorType;
    actorId: string;
  },
): Promise<void> {
  // The commenter (if human) starts following the task.
  if (args.actorType === 'user') {
    await autoSubscribe(ctx, {
      task: args.task,
      subscriberType: 'user',
      subscriberId: args.actorId,
      reason: 'commenter',
    });
  }

  const mentionedUserIds = new Set(
    args.mentions.filter((m) => m.type === 'user').map((m) => m.id),
  );

  // Mentioned users: subscribe + a 'mention' notification (takes precedence).
  for (const userId of mentionedUserIds) {
    if (args.actorType === 'user' && userId === args.actorId) continue;
    const taskForSub = args.task;
    await autoSubscribe(ctx, {
      task: taskForSub,
      subscriberType: 'user',
      subscriberId: userId,
      reason: 'mention',
    });
    await writeNotification(ctx, {
      userId,
      organizationId: args.task.organizationId,
      type: 'mention',
      titleKey: 'mention',
      bodyKey: 'mentionBody',
      params: { title: args.task.title },
      resourceType: 'comment',
      resourceId: String(args.commentId),
      taskId: args.task._id,
      actorType: args.actorType,
      actorId: args.actorId,
    });
  }

  // Other subscribers get a comment notification (skip actor + already-mentioned).
  const subscribers = withoutActor(
    await taskSubscriberUserIds(ctx, args.task._id),
    args.actorType,
    args.actorId,
  );
  for (const userId of subscribers) {
    if (mentionedUserIds.has(userId)) continue;
    await writeNotification(ctx, {
      userId,
      organizationId: args.task.organizationId,
      type: 'task_commented',
      titleKey: 'taskCommented',
      bodyKey: 'taskCommentedBody',
      params: { title: args.task.title },
      resourceType: 'comment',
      resourceId: String(args.commentId),
      taskId: args.task._id,
      actorType: args.actorType,
      actorId: args.actorId,
    });
  }
}
