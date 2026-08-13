/**
 * Content-notification fan-out for tasks. These helpers run INSIDE the task
 * mutations (transactional with the write), distinct from `emitEvent` (which is
 * the fire-and-forget transport for the automation engine). One `userNotifications`
 * row is written per recipient; the actor is never notified of their own action.
 */

import type { Infer } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { DatabaseReader, MutationCtx } from '../_generated/server';
import { resolveUserDisplayName } from '../notifications/actor_name';
import { queueActionableEmail } from './notify_email';
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
  | 'conversationMessages'
> = {
  task_assigned: 'taskAssigned',
  task_status_changed: 'taskStatusChanged',
  task_commented: 'taskCommented',
  mention: 'mention',
  task_review_requested: 'taskReview',
  task_review_resolved: 'taskReview',
  task_reviewer_assigned: 'taskReview',
  // Document reviews ride the same locked-on review group (see `isAllowed`).
  document_review_requested: 'taskReview',
  document_review_resolved: 'taskReview',
  agent_escalation: 'escalation',
  automation_failed: 'automationAlerts',
  budget_alert: 'automationAlerts',
  runtime_offline: 'automationAlerts',
  // RETIRED type — mapping kept while the schema literal drains (see schema.ts).
  workforce_digest: 'digest',
  conversation_message: 'conversationMessages',
  conversation_assigned: 'conversationMessages',
};

/** Tri-state email delivery toggle — independent of in-app per-type prefs. */
export async function isActionableEmailEnabled(
  ctx: { db: DatabaseReader },
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const prefs = await ctx.db
    .query('notificationPreferences')
    .withIndex('by_userId_organizationId', (q) =>
      q.eq('userId', userId).eq('organizationId', organizationId),
    )
    .first();
  const value = prefs?.actionableEmail;
  return value === undefined ? true : value;
}

/** Tri-state preference resolution: undefined → default ON. Shared with the
 *  automation fan-out (`internal_mutations.ts::notifyFromAutomation`). */
export async function isAllowed(
  ctx: MutationCtx,
  userId: string,
  organizationId: string,
  type: NotificationType,
): Promise<boolean> {
  // Review requests are a safety signal — the settings UI locks the toggle
  // always-on (#2651), and automation-fired review reminders/resolutions
  // (this is the gate `notifyFromAutomation` uses) must honor that lock too.
  // Ignore any stored `taskReview` value, including a stale `false`
  // persisted before the lock shipped — no migration needed since the
  // stored value is simply never read.
  if (PREF_FIELD[type] === 'taskReview') return true;
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
      | 'dashboard'
      | 'conversation';
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
  await queueActionableEmail(ctx, {
    userId: args.userId,
    organizationId: args.organizationId,
    type: args.type,
    titleKey: args.titleKey,
    bodyKey: args.bodyKey,
    params: args.params,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    taskId: args.taskId,
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
    /** The full worker trichotomy — only a HUMAN assignee gets a
     * notification; agents and automations have no inbox. */
    assigneeType: 'user' | 'agent' | 'app' | null;
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
 * Notify a member that an admin assigned them a conversation. Mirrors
 * {@link notifyTaskAssigned}: the new assignee (a human `userId` — conversations
 * have no agent owners) gets one in-app row + an actionable email, the actor is
 * never notified of self-assignment, and the body is locale-safe (impersonal
 * unless the actor has a proper-noun name). Params carry `conversationId` +
 * `conversationStatus` so the notification deep-links to the thread
 * (`personalNotificationTarget`). No task subscriptions / activity feed here.
 */
export async function notifyConversationAssigned(
  ctx: MutationCtx,
  args: {
    conversation: Doc<'conversations'>;
    assigneeUserId: string | null;
    actorType: ActorType;
    actorId: string;
  },
): Promise<void> {
  if (!args.assigneeUserId) return;
  // Don't notify someone who assigned the conversation to themselves.
  if (args.actorType === 'user' && args.actorId === args.assigneeUserId) return;
  const actorName = await resolveActorName(ctx, args.actorType, args.actorId);
  await writeNotification(ctx, {
    userId: args.assigneeUserId,
    organizationId: args.conversation.organizationId,
    type: 'conversation_assigned',
    titleKey: 'conversationAssigned',
    bodyKey: actorName
      ? 'conversationAssignedByBody'
      : 'conversationAssignedBody',
    params: {
      subject: args.conversation.subject ?? '',
      conversationId: String(args.conversation._id),
      conversationStatus: args.conversation.status ?? 'open',
      ...(actorName ? { actor: actorName } : {}),
    },
    resourceType: 'conversation',
    resourceId: String(args.conversation._id),
    actorType: args.actorType,
    actorId: args.actorId,
  });
}

/** Cap on a per-team assignment fan-out — matches the automation fan-out bound
 *  (`collab/internal_mutations.ts` MAX_RECIPIENTS). */
const MAX_TEAM_ASSIGN_RECIPIENTS = 500;

/**
 * Notify a team's members that an admin queued a conversation to their team —
 * the team counterpart of {@link notifyConversationAssigned}. One in-app row +
 * actionable email per member (read from the local `teamMemberMirror`), the
 * actor is never notified, users are de-duped across membership rows, and the
 * fan-out is bounded at {@link MAX_TEAM_ASSIGN_RECIPIENTS}. Reuses the
 * `conversation_assigned` type (no schema change) with a team-specific,
 * locale-safe body (impersonal unless the actor has a proper-noun name).
 */
export async function notifyConversationAssignedTeam(
  ctx: MutationCtx,
  args: {
    conversation: Doc<'conversations'>;
    teamId: string;
    // The admin who queued it, or null for a system/routing assignment
    // (impersonal body, and no actor to self-skip).
    actorUserId: string | null;
  },
): Promise<void> {
  const actorName = args.actorUserId
    ? await resolveUserDisplayName(ctx, args.actorUserId)
    : null;
  const seen = new Set<string>();
  let notified = 0;
  for await (const row of ctx.db
    .query('teamMemberMirror')
    .withIndex('by_teamId', (q) => q.eq('teamId', args.teamId))) {
    // Never notify the acting admin of their own action; de-dupe a user who
    // appears in more than one membership row.
    if (args.actorUserId && row.userId === args.actorUserId) continue;
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);
    if (notified >= MAX_TEAM_ASSIGN_RECIPIENTS) break;
    notified++;
    await writeNotification(ctx, {
      userId: row.userId,
      organizationId: args.conversation.organizationId,
      type: 'conversation_assigned',
      titleKey: 'conversationTeamAssigned',
      bodyKey: actorName
        ? 'conversationTeamAssignedByBody'
        : 'conversationTeamAssignedBody',
      params: {
        subject: args.conversation.subject ?? '',
        conversationId: String(args.conversation._id),
        conversationStatus: args.conversation.status ?? 'open',
        ...(actorName ? { actor: actorName } : {}),
      },
      resourceType: 'conversation',
      resourceId: String(args.conversation._id),
      actorType: args.actorUserId ? 'user' : 'system',
      actorId: args.actorUserId ?? undefined,
    });
  }
}

/**
 * Notify on a SYSTEM-initiated assignment (address routing at ingest) —
 * impersonal bodies, no actor. Notifies the newly-set individual owner and/or
 * fans out to the newly-queued team. Only the dimensions actually set by the
 * routing rule are passed, so no one is re-notified for an unchanged field.
 */
export async function notifyConversationRouted(
  ctx: MutationCtx,
  args: {
    conversation: Doc<'conversations'>;
    assigneeUserId?: string;
    assigneeTeamId?: string;
  },
): Promise<void> {
  if (args.assigneeUserId) {
    await writeNotification(ctx, {
      userId: args.assigneeUserId,
      organizationId: args.conversation.organizationId,
      type: 'conversation_assigned',
      titleKey: 'conversationAssigned',
      bodyKey: 'conversationAssignedBody',
      params: {
        subject: args.conversation.subject ?? '',
        conversationId: String(args.conversation._id),
        conversationStatus: args.conversation.status ?? 'open',
      },
      resourceType: 'conversation',
      resourceId: String(args.conversation._id),
      actorType: 'system',
    });
  }
  if (args.assigneeTeamId) {
    await notifyConversationAssignedTeam(ctx, {
      conversation: args.conversation,
      teamId: args.assigneeTeamId,
      actorUserId: null,
    });
  }
}

/** Mention fan-out for private/project-scoped agent chat threads. */
export async function notifyChatMentions(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    threadId: string;
    threadTitle: string;
    mentions: Array<{ type: 'user' | 'agent'; id: string }>;
    actorType: ActorType;
    actorId: string;
    projectId?: Id<'projects'>;
  },
): Promise<void> {
  const actorName = await resolveActorName(ctx, args.actorType, args.actorId);
  for (const mention of args.mentions) {
    if (mention.type !== 'user') continue;
    if (args.actorType === 'user' && mention.id === args.actorId) continue;
    await writeNotification(ctx, {
      userId: mention.id,
      organizationId: args.organizationId,
      type: 'mention',
      titleKey: 'mention',
      bodyKey: actorName ? 'mentionByBody' : 'mentionBody',
      params: {
        title: args.threadTitle,
        threadId: args.threadId,
        chat: true,
        ...(args.projectId ? { projectId: String(args.projectId) } : {}),
      },
      resourceType: 'thread',
      resourceId: args.threadId,
      actorType: args.actorType,
      actorId: args.actorId,
    });
  }
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
    /**
     * When false, only newly mentioned humans are notified (comment *edit*
     * fan-out). Defaults to true so a fresh comment still alerts other
     * subscribers with `task_commented`.
     */
    notifySubscribers?: boolean;
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

  if (args.notifySubscribers === false) return;

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
