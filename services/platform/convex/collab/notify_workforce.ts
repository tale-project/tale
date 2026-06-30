/**
 * Workforce (task-ops) inbox emitters — the human half of human-in-the-loop.
 * Transactional with their source mutations, mirroring `notify.ts`.
 *
 * `task_review_requested` deliberately SKIPS the preference gate for the
 * designated reviewer: the review gate is a safety signal and must never
 * starve silently because someone muted a category. `task_review_resolved`
 * respects the tri-state `taskReview` preference like a normal notification.
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

type WorkforceNotificationType =
  | 'task_review_requested'
  | 'task_review_resolved'
  | 'agent_escalation';

async function prefAllows(
  ctx: MutationCtx,
  userId: string,
  organizationId: string,
  field: 'taskReview' | 'escalation',
): Promise<boolean> {
  const prefs = await ctx.db
    .query('notificationPreferences')
    .withIndex('by_userId_organizationId', (q) =>
      q.eq('userId', userId).eq('organizationId', organizationId),
    )
    .first();
  const value = prefs?.[field];
  return value === undefined ? true : value;
}

async function insertWorkforceNotification(
  ctx: MutationCtx,
  args: {
    userId: string;
    organizationId: string;
    type: WorkforceNotificationType;
    titleKey: string;
    bodyKey: string;
    params: Record<string, unknown>;
    resourceType: 'task_review' | 'task';
    resourceId: string;
    taskId: Id<'tasks'>;
    actorType: 'user' | 'agent' | 'system';
    actorId?: string;
  },
): Promise<void> {
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

/** Inbox params stay PII-lean: ids + titles only (org content, not subject PII). */
function reviewParams(
  task: Doc<'tasks'>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    taskId: String(task._id),
    projectId: String(task.projectId),
    taskTitle: task.title,
    ...extra,
  };
}

/** Actionable review request to the designated reviewer (pref gate skipped). */
export async function notifyTaskReviewRequested(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    reviewerUserId: string;
    approvalId: Id<'approvals'>;
    agentSlug?: string;
  },
): Promise<void> {
  // The default body names the agent (`{agentSlug}`); when no agent slug is
  // available (e.g. a workflow-initiated review) fall back to a generic body
  // with no `{agentSlug}` placeholder so the bell never renders a raw token.
  await insertWorkforceNotification(ctx, {
    userId: args.reviewerUserId,
    organizationId: args.task.organizationId,
    type: 'task_review_requested',
    titleKey: 'taskReviewRequested',
    bodyKey: args.agentSlug
      ? 'taskReviewRequestedBody'
      : 'taskReviewRequestedBodyNoAgent',
    params: reviewParams(args.task, {
      approvalId: String(args.approvalId),
      ...(args.agentSlug ? { agentSlug: args.agentSlug } : {}),
    }),
    resourceType: 'task_review',
    resourceId: String(args.approvalId),
    taskId: args.task._id,
    actorType: 'agent',
    actorId: args.agentSlug,
  });
}

/** Review outcome to watchers (minus the deciding actor), pref-gated. */
export async function notifyTaskReviewResolved(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    decision: 'approve' | 'request_changes';
    decidedByUserId: string;
    recipientUserIds: string[];
  },
): Promise<void> {
  for (const userId of args.recipientUserIds) {
    if (userId === args.decidedByUserId) continue;
    if (
      !(await prefAllows(ctx, userId, args.task.organizationId, 'taskReview'))
    ) {
      continue;
    }
    await insertWorkforceNotification(ctx, {
      userId,
      organizationId: args.task.organizationId,
      type: 'task_review_resolved',
      titleKey:
        args.decision === 'approve'
          ? 'taskReviewApproved'
          : 'taskReviewChangesRequested',
      bodyKey:
        args.decision === 'approve'
          ? 'taskReviewApprovedBody'
          : 'taskReviewChangesRequestedBody',
      params: reviewParams(args.task),
      resourceType: 'task',
      resourceId: String(args.task._id),
      taskId: args.task._id,
      actorType: 'user',
      actorId: args.decidedByUserId,
    });
  }
}
