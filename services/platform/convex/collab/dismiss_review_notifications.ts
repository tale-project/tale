/**
 * Marks stale review-request bell rows read when an approval resolves.
 * Covers the initial transactional ping (resourceId = approvalId), automation
 * reminders (resourceId = taskId, params.approvalId), and admin escalations.
 */

import { isRecord } from '../../lib/utils/type-utils';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

const MEMBER_SCAN_CAP = 500;
const UNREAD_SCAN_CAP = 100;

function matchesResolvedReviewNotification(
  row: {
    type: string;
    read: boolean;
    resourceId: string;
    params?: unknown;
  },
  approvalId: string,
): boolean {
  if (row.type !== 'task_review_requested' || row.read) return false;

  // Match only THIS approval. Every real review bell carries the approval id as
  // `resourceId` (transactional ping) or `params.approvalId` (automation
  // reminders). A task-level match would wrongly clear OTHER still-pending
  // reviews on the same task (a task can hold >1 concurrent review approval).
  if (row.resourceId === approvalId) return true;
  if (isRecord(row.params) && row.params.approvalId === approvalId) return true;

  return false;
}

/** Returns the number of notification rows marked read. */
export async function dismissReviewRequestNotifications(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    approvalId: Id<'approvals'>;
    taskId: Id<'tasks'>;
  },
): Promise<number> {
  const approvalIdStr = args.approvalId;
  const now = Date.now();
  let dismissed = 0;

  // NOTE (scale limitation): `userNotifications` is indexed by user first, so
  // there is no way to find a review bell by approval/task without the userId —
  // hence this per-member fan-out. It caps at MEMBER_SCAN_CAP, so in an org with
  // more members a reviewer past the cap won't get their stale bell auto-cleared
  // (the review is still actionable in the task sheet — no correctness loss, just
  // a lingering bell). The clean fix is a `userNotifications` index on
  // (organizationId, taskId) so we can target `args.taskId` directly; deferred to
  // avoid a schema change in this PR.
  const userIds: string[] = [];
  for await (const member of ctx.db
    .query('memberMirror')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', args.organizationId),
    )) {
    userIds.push(member.userId);
    if (userIds.length >= MEMBER_SCAN_CAP) break;
  }

  for (const userId of userIds) {
    const unread = await ctx.db
      .query('userNotifications')
      .withIndex('by_user_org_read', (q) =>
        q
          .eq('userId', userId)
          .eq('organizationId', args.organizationId)
          .eq('read', false),
      )
      .order('desc')
      .take(UNREAD_SCAN_CAP);

    for (const row of unread) {
      if (!matchesResolvedReviewNotification(row, approvalIdStr)) {
        continue;
      }
      await ctx.db.patch(row._id, { read: true, readAt: now });
      dismissed += 1;
    }
  }

  return dismissed;
}
