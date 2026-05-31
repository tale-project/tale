/**
 * User-facing task subscription management (watch / unwatch / mute).
 */

import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { mutation, query, type QueryCtx } from '../_generated/server';
import { authComponent } from '../auth';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls';
import { checkProjectAccess } from '../projects/access';

async function resolveTaskAccess(
  ctx: QueryCtx,
  taskId: Id<'tasks'>,
): Promise<{ userId: string; organizationId: string }> {
  const task = await ctx.db.get(taskId);
  if (!task) throw new ConvexError({ code: 'TASK_NOT_FOUND' });
  const project = await ctx.db.get(task.projectId);
  if (!project) throw new ConvexError({ code: 'PROJECT_NOT_FOUND' });
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });
  const member = await getOrganizationMember(ctx, task.organizationId, {
    userId: String(authUser._id),
    email: authUser.email,
    name: authUser.name,
  });
  const teamIds = await getUserTeamIds(ctx, member.userId);
  if (!checkProjectAccess(project, teamIds, member.role).canRead) {
    throw new ConvexError({ code: 'TASK_FORBIDDEN' });
  }
  return { userId: member.userId, organizationId: task.organizationId };
}

export const subscribeToTask = mutation({
  args: { taskId: v.id('tasks') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, organizationId } = await resolveTaskAccess(
      ctx,
      args.taskId,
    );
    const existing = await ctx.db
      .query('taskSubscriptions')
      .withIndex('by_task_subscriber', (q) =>
        q
          .eq('taskId', args.taskId)
          .eq('subscriberType', 'user')
          .eq('subscriberId', userId),
      )
      .first();
    if (existing) {
      if (existing.muted) await ctx.db.patch(existing._id, { muted: false });
      return null;
    }
    await ctx.db.insert('taskSubscriptions', {
      organizationId,
      taskId: args.taskId,
      subscriberType: 'user',
      subscriberId: userId,
      reason: 'manual',
      createdAt: Date.now(),
    });
    return null;
  },
});

export const setTaskMuted = mutation({
  args: { taskId: v.id('tasks'), muted: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await resolveTaskAccess(ctx, args.taskId);
    const existing = await ctx.db
      .query('taskSubscriptions')
      .withIndex('by_task_subscriber', (q) =>
        q
          .eq('taskId', args.taskId)
          .eq('subscriberType', 'user')
          .eq('subscriberId', userId),
      )
      .first();
    if (existing) await ctx.db.patch(existing._id, { muted: args.muted });
    return null;
  },
});

export const unsubscribeFromTask = mutation({
  args: { taskId: v.id('tasks') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await resolveTaskAccess(ctx, args.taskId);
    const existing = await ctx.db
      .query('taskSubscriptions')
      .withIndex('by_task_subscriber', (q) =>
        q
          .eq('taskId', args.taskId)
          .eq('subscriberType', 'user')
          .eq('subscriberId', userId),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

export const isSubscribedToTask = query({
  args: { taskId: v.id('tasks') },
  returns: v.object({ subscribed: v.boolean(), muted: v.boolean() }),
  handler: async (ctx, args) => {
    const { userId } = await resolveTaskAccess(ctx, args.taskId);
    const existing = await ctx.db
      .query('taskSubscriptions')
      .withIndex('by_task_subscriber', (q) =>
        q
          .eq('taskId', args.taskId)
          .eq('subscriberType', 'user')
          .eq('subscriberId', userId),
      )
      .first();
    return {
      subscribed: existing !== null,
      muted: existing?.muted ?? false,
    };
  },
});
