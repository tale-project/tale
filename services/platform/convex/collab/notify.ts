/**
 * Content-notification fan-out for tasks. These helpers run INSIDE the task
 * mutations (transactional with the write), distinct from `emitEvent` (which is
 * the fire-and-forget transport for the automation engine). One `userNotifications`
 * row is written per recipient; the actor is never notified of their own action.
 */

import type { Infer } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { resolveUserDisplayName } from '../notifications/actor_name';
import type {
  notificationTypeValidator,
  subscriptionReasonValidator,
} from './schema';

type NotificationType = Infer<typeof notificationTypeValidator>;
type SubscriptionReason = Infer<typeof subscriptionReasonValidator>;
type ActorType = 'user' | 'agent';

const PREF_FIELD: Record<
  NotificationType,
  | 'taskAssigned'
  | 'taskStatusChanged'
  | 'taskCommented'
  | 'mention'
  | 'taskReview'
  | 'escalation'
  | 'automationAlerts'
  | 'digest'
> = {
  task_assigned: 'taskAssigned',
  task_status_changed: 'taskStatusChanged',
  task_commented: 'taskCommented',
  mention: 'mention',
  task_review_requested: 'taskReview',
  task_review_resolved: 'taskReview',
  agent_escalation: 'escalation',
  automation_failed: 'automationAlerts',
  budget_alert: 'automationAlerts',
  runtime_offline: 'automationAlerts',
  workforce_digest: 'digest',
};

/** Tri-state preference resolution: undefined → default ON. Shared with the
 *  automation fan-out (`internal_mutations.ts::notifyFromAutomation`). */
export async function isAllowed(
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
    resourceType:
      | 'task'
      | 'comment'
      | 'thread'
      | 'task_review'
      | 'wf_execution'
      | 'runtime'
      | 'dashboard';
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
export async function taskSubscriberUserIds(
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

/**
 * A locale-independent display name for the actor, or null when we have none
 * safe to drop into localized copy. A human actor resolves to their name/email
 * (a proper noun). Agent actors have no locale-safe label here, so they fall
 * back to the impersonal body rather than leaking an English word into DE/FR.
 */
async function resolveActorName(
  ctx: MutationCtx,
  actorType: ActorType,
  actorId: string,
): Promise<string | null> {
  if (actorType !== 'user') return null;
  return resolveUserDisplayName(ctx, actorId);
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
  const actorName = await resolveActorName(ctx, args.actorType, args.actorId);
  for (const userId of recipients) {
    await writeNotification(ctx, {
      userId,
      organizationId: args.task.organizationId,
      type: 'task_status_changed',
      titleKey: 'taskStatusChanged',
      bodyKey: actorName ? 'taskStatusChangedByBody' : 'taskStatusChangedBody',
      params: {
        title: args.task.title,
        projectId: String(args.task.projectId),
        from: args.fromStatus,
        to: args.toStatus,
        ...(actorName ? { actor: actorName } : {}),
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
  const actorName = await resolveActorName(ctx, args.actorType, args.actorId);
  await writeNotification(ctx, {
    userId: args.assigneeId,
    organizationId: args.task.organizationId,
    type: 'task_assigned',
    titleKey: 'taskAssigned',
    bodyKey: actorName ? 'taskAssignedByBody' : 'taskAssignedBody',
    params: {
      title: args.task.title,
      projectId: String(args.task.projectId),
      ...(actorName ? { actor: actorName } : {}),
    },
    resourceType: 'task',
    resourceId: String(args.task._id),
    taskId: args.task._id,
    actorType: args.actorType,
    actorId: args.actorId,
  });
}

/**
 * Mention fan-out for the task BODY (description) — the counterpart of the
 * mention half of {@link notifyTaskComment} for `@`s typed into the task
 * description on create/edit. Callers pass only the NEWLY added mentions so
 * an unrelated description edit never re-notifies everyone already mentioned.
 */
export async function notifyTaskMentions(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    mentions: Array<{ type: 'user' | 'agent'; id: string }>;
    actorType: ActorType;
    actorId: string;
  },
): Promise<void> {
  const actorName = await resolveActorName(ctx, args.actorType, args.actorId);
  for (const mention of args.mentions) {
    if (mention.type !== 'user') continue;
    if (args.actorType === 'user' && mention.id === args.actorId) continue;
    await autoSubscribe(ctx, {
      task: args.task,
      subscriberType: 'user',
      subscriberId: mention.id,
      reason: 'mention',
    });
    await writeNotification(ctx, {
      userId: mention.id,
      organizationId: args.task.organizationId,
      type: 'mention',
      titleKey: 'mention',
      bodyKey: actorName ? 'mentionByBody' : 'mentionBody',
      params: {
        title: args.task.title,
        projectId: String(args.task.projectId),
        ...(actorName ? { actor: actorName } : {}),
      },
      resourceType: 'task',
      resourceId: String(args.task._id),
      taskId: args.task._id,
      actorType: args.actorType,
      actorId: args.actorId,
    });
  }
}

export async function notifyTaskComment(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    // The comment's identity for the notification deep-link. Now a message id
    // (string) since task comments live in the message store; `resourceId`
    // already stores it via `String()`, and `resourceType:'comment'` is unchanged.
    commentId: string;
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

  const actorName = await resolveActorName(ctx, args.actorType, args.actorId);

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
      bodyKey: actorName ? 'mentionByBody' : 'mentionBody',
      params: {
        title: args.task.title,
        projectId: String(args.task.projectId),
        ...(actorName ? { actor: actorName } : {}),
      },
      resourceType: 'comment',
      resourceId: args.commentId,
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
      bodyKey: actorName ? 'taskCommentedByBody' : 'taskCommentedBody',
      params: {
        title: args.task.title,
        projectId: String(args.task.projectId),
        ...(actorName ? { actor: actorName } : {}),
      },
      resourceType: 'comment',
      resourceId: args.commentId,
      taskId: args.task._id,
      actorType: args.actorType,
      actorId: args.actorId,
    });
  }
}
