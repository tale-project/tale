/**
 * Task-review inbox emitters — the human half of human-in-the-loop.
 * Transactional with their source mutations, mirroring `notify.ts`.
 *
 * `task_review_requested` deliberately SKIPS the preference gate for the
 * designated reviewer: the review gate is a safety signal and must never
 * starve silently because someone muted a category. `task_review_resolved`
 * also ignores the stored `taskReview` preference (including a stale
 * `false` persisted before the settings UI locked the toggle always-on,
 * #2651) — see `prefAllows` below.
 */

import type { MutationCtx } from '../lib/ctx';
import type { Doc, Id } from '../lib/rows';
import { resolveUserDisplayName } from '../notifications/actor_name';
import { writeCoalescedNotification } from './coalesce';

type TaskReviewNotificationType =
  | 'task_review_requested'
  | 'task_review_resolved'
  | 'task_reviewer_assigned';

async function prefAllows(
  ctx: MutationCtx,
  userId: string,
  organizationId: string,
  field: 'taskReview' | 'escalation',
): Promise<boolean> {
  // Review requests are a safety signal — the settings UI locks the toggle
  // always-on (#2651). Ignore any stored `taskReview` value, including a
  // stale `false` persisted before that lock shipped: the server must not
  // let an old row silently keep suppressing review notifications forever.
  // No migration needed since the stored value is simply never read.
  if (field === 'taskReview') return true;
  const prefs = await ctx.db
    .query('notificationPreferences')
    .withIndex('by_userId_organizationId', (q) =>
      q.eq('userId', userId).eq('organizationId', organizationId),
    )
    .first();
  const value = prefs?.[field];
  return value === undefined ? true : value;
}

async function insertTaskReviewNotification(
  ctx: MutationCtx,
  args: {
    userId: string;
    organizationId: string;
    type: TaskReviewNotificationType;
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
  await writeCoalescedNotification(ctx, args);
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

/**
 * Who submitted the work now waiting on review. The gate is a STATE, so the
 * submitter can be an agent run's driver or the person who moved the card —
 * the copy names whichever it was instead of asserting "agent work".
 */
export type TaskReviewSubmitter =
  | { kind: 'agent'; name?: string }
  | { kind: 'user'; userId: string };

/** Actionable review request to the designated reviewer (pref gate skipped). */
export async function notifyTaskReviewRequested(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    reviewerUserId: string;
    approvalId: Id<'approvals'>;
    submitter: TaskReviewSubmitter;
  },
): Promise<void> {
  // Nobody is asked to review their own submission: the approval is still
  // minted (the board chip and the needs-my-review facet read it), only the
  // ping is pointless.
  if (
    args.submitter.kind === 'user' &&
    args.submitter.userId === args.reviewerUserId
  ) {
    return;
  }

  // Agent submissions name the driver (`{agentSlug}`) and fall back to the
  // impersonal body when no driver name resolves, so the bell never renders a
  // raw token. Human submissions name the person (a proper noun, locale-safe)
  // and fall back to a body that doesn't claim an agent did the work.
  const actorName =
    args.submitter.kind === 'user'
      ? await resolveUserDisplayName(ctx, args.submitter.userId)
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

  await insertTaskReviewNotification(ctx, {
    userId: args.reviewerUserId,
    organizationId: args.task.organizationId,
    type: 'task_review_requested',
    titleKey: 'taskReviewRequested',
    bodyKey,
    params: reviewParams(args.task, {
      approvalId: args.approvalId,
      ...(agentName ? { agentSlug: agentName } : {}),
      ...(actorName ? { actor: actorName } : {}),
    }),
    resourceType: 'task_review',
    resourceId: args.approvalId,
    taskId: args.task._id,
    ...(args.submitter.kind === 'user'
      ? { actorType: 'user' as const, actorId: args.submitter.userId }
      : { actorType: 'agent' as const, actorId: agentName }),
  });
}

/**
 * Heads-up to a freshly designated reviewer while the work is still in flight
 * — "you're on the hook for this one". Bell only: the review is not due yet, so
 * this deliberately stays out of `ACTIONABLE_NOTIFICATION_TYPES` (no email).
 * The actionable request + email follows when the task reaches `in_review`.
 */
export async function notifyTaskReviewerAssigned(
  ctx: MutationCtx,
  args: {
    task: Doc<'tasks'>;
    reviewerUserId: string;
    actorUserId: string;
  },
): Promise<void> {
  if (args.reviewerUserId === args.actorUserId) return;
  const actorName = await resolveUserDisplayName(ctx, args.actorUserId);
  await insertTaskReviewNotification(ctx, {
    userId: args.reviewerUserId,
    organizationId: args.task.organizationId,
    type: 'task_reviewer_assigned',
    titleKey: 'taskReviewerAssigned',
    bodyKey: actorName
      ? 'taskReviewerAssignedByBody'
      : 'taskReviewerAssignedBody',
    params: reviewParams(args.task, actorName ? { actor: actorName } : {}),
    resourceType: 'task',
    resourceId: String(args.task._id),
    taskId: args.task._id,
    actorType: 'user',
    actorId: args.actorUserId,
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
    await insertTaskReviewNotification(ctx, {
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
