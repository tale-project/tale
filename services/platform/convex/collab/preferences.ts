/**
 * Per-user notification preferences (tri-state: undefined → system default ON).
 */

import { v } from 'convex/values';

import { mutation, query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

const prefsValidator = v.object({
  taskAssigned: v.optional(v.boolean()),
  taskStatusChanged: v.optional(v.boolean()),
  taskCommented: v.optional(v.boolean()),
  mention: v.optional(v.boolean()),
  taskReview: v.optional(v.boolean()),
  escalation: v.optional(v.boolean()),
  automationAlerts: v.optional(v.boolean()),
  digest: v.optional(v.boolean()),
});

export const getNotificationPreferences = query({
  args: { organizationId: v.string() },
  returns: prefsValidator,
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
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
      taskReview: row?.taskReview,
      escalation: row?.escalation,
      automationAlerts: row?.automationAlerts,
      digest: row?.digest,
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
    taskReview: v.optional(v.boolean()),
    escalation: v.optional(v.boolean()),
    automationAlerts: v.optional(v.boolean()),
    digest: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
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
      taskReview: args.taskReview,
      escalation: args.escalation,
      automationAlerts: args.automationAlerts,
      digest: args.digest,
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
