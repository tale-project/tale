/**
 * Return-loop queries — "what needs me back in Tale?"
 */

import { v } from 'convex/values';

import { isActionableNotificationType } from '../../lib/shared/attention';
import { isRecord } from '../../lib/utils/type-utils';
import type { Id } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

const LIST_CAP = 100;

async function resolveUserId(
  ctx: QueryCtx,
  organizationId: string,
): Promise<string> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new Error('Unauthenticated');
  const member = await getOrganizationMember(ctx, organizationId, authUser);
  return member.userId;
}

export const getMyAttentionSummary = query({
  args: {
    organizationId: v.string(),
    projectId: v.optional(v.id('projects')),
  },
  returns: v.object({
    unreadActionableCount: v.number(),
    unreadTotalCount: v.number(),
    waitingOnMeTaskIds: v.array(v.id('tasks')),
    pendingReviewCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await resolveUserId(ctx, args.organizationId);

    let unreadActionableCount = 0;
    let unreadTotalCount = 0;
    for await (const row of ctx.db
      .query('userNotifications')
      .withIndex('by_user_org_read', (q) =>
        q
          .eq('userId', userId)
          .eq('organizationId', args.organizationId)
          .eq('read', false),
      )) {
      unreadTotalCount += 1;
      if (isActionableNotificationType(row.type)) {
        unreadActionableCount += 1;
      }
      if (unreadTotalCount >= LIST_CAP) break;
    }

    const waitingOnMe = new Set<Id<'tasks'>>();
    let pendingReviewCount = 0;

    for await (const approval of ctx.db
      .query('approvals')
      .withIndex('by_org_status_resourceType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('status', 'pending')
          .eq('resourceType', 'task_review'),
      )) {
      const metadata = approval.metadata;
      if (!isRecord(metadata)) continue;
      if (metadata.requestedFor !== userId) continue;
      const taskIdRaw =
        typeof metadata.taskId === 'string'
          ? metadata.taskId
          : approval.resourceId;
      const taskId = ctx.db.normalizeId('tasks', taskIdRaw);
      if (!taskId) continue;
      if (args.projectId) {
        const task = await ctx.db.get(taskId);
        if (!task || task.projectId !== args.projectId) continue;
      }
      waitingOnMe.add(taskId);
      pendingReviewCount += 1;
      if (waitingOnMe.size >= LIST_CAP) break;
    }

    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_assignee', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('assigneeType', 'user')
          .eq('assigneeId', userId),
      )) {
      if (task.archivedAt) continue;
      if (
        task.status !== 'todo' &&
        task.status !== 'in_progress' &&
        task.status !== 'in_review'
      ) {
        continue;
      }
      if (args.projectId && task.projectId !== args.projectId) continue;
      waitingOnMe.add(task._id);
      if (waitingOnMe.size >= LIST_CAP) break;
    }

    return {
      unreadActionableCount,
      unreadTotalCount,
      waitingOnMeTaskIds: [...waitingOnMe],
      pendingReviewCount,
    };
  },
});
