import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

/**
 * Append the calling user to a notification's `readBy` set. Idempotent —
 * repeated calls are no-ops once the user is recorded.
 */
export const markRead = mutation({
  args: { notificationId: v.id('notifications') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const notification = await ctx.db.get(args.notificationId);
    if (!notification) return null;

    // Authorization: caller must be a member of the notification's org.
    await getOrganizationMember(ctx, notification.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const userId = String(authUser._id);
    if (notification.readBy.includes(userId)) return null;

    await ctx.db.patch(notification._id, {
      readBy: [...notification.readBy, userId],
    });
    return null;
  },
});

export const markAllRead = mutation({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const userId = String(authUser._id);
    for await (const n of ctx.db
      .query('notifications')
      .withIndex('by_org_created', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (!n.readBy.includes(userId)) {
        await ctx.db.patch(n._id, { readBy: [...n.readBy, userId] });
      }
    }
    return null;
  },
});
