/**
 * Per-user notification preferences (tri-state: undefined → system default ON).
 */

import { v } from 'convex/values';

import { mutation, query } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

const prefsValidator = v.object({
  taskAssigned: v.optional(v.boolean()),
  taskStatusChanged: v.optional(v.boolean()),
  taskCommented: v.optional(v.boolean()),
  mention: v.optional(v.boolean()),
});

export const getNotificationPreferences = query({
  args: { organizationId: v.string() },
  returns: prefsValidator,
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });
    const row = await ctx.db
      .query('notificationPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q.eq('userId', member.userId).eq('organizationId', args.organizationId),
      )
      .first();
    return {
      taskAssigned: row?.taskAssigned,
      taskStatusChanged: row?.taskStatusChanged,
      taskCommented: row?.taskCommented,
      mention: row?.mention,
    };
  },
});

export const setNotificationPreferences = mutation({
  args: {
    organizationId: v.string(),
    taskAssigned: v.optional(v.boolean()),
    taskStatusChanged: v.optional(v.boolean()),
    taskCommented: v.optional(v.boolean()),
    mention: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });
    const existing = await ctx.db
      .query('notificationPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q.eq('userId', member.userId).eq('organizationId', args.organizationId),
      )
      .first();
    const patch = {
      taskAssigned: args.taskAssigned,
      taskStatusChanged: args.taskStatusChanged,
      taskCommented: args.taskCommented,
      mention: args.mention,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('notificationPreferences', {
        userId: member.userId,
        organizationId: args.organizationId,
        ...patch,
      });
    }
    return null;
  },
});
