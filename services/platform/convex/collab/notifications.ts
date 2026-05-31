/**
 * Per-user content notification inbox: list, unread count, mark read.
 */

import { v } from 'convex/values';

import { mutation, query, type QueryCtx } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import {
  notificationActorTypeValidator,
  notificationTypeValidator,
} from './schema';

const INBOX_PAGE_CAP = 100;

async function resolveUserId(
  ctx: QueryCtx,
  organizationId: string,
): Promise<string> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) throw new Error('Unauthenticated');
  const member = await getOrganizationMember(ctx, organizationId, {
    userId: String(authUser._id),
    email: authUser.email,
    name: authUser.name,
  });
  return member.userId;
}

const notificationRowValidator = v.object({
  _id: v.id('userNotifications'),
  _creationTime: v.number(),
  userId: v.string(),
  organizationId: v.string(),
  type: notificationTypeValidator,
  titleKey: v.string(),
  bodyKey: v.string(),
  params: v.optional(v.any()),
  resourceType: v.union(
    v.literal('task'),
    v.literal('comment'),
    v.literal('thread'),
  ),
  resourceId: v.string(),
  taskId: v.optional(v.id('tasks')),
  actorType: notificationActorTypeValidator,
  actorId: v.optional(v.string()),
  read: v.boolean(),
  readAt: v.optional(v.number()),
  createdAt: v.number(),
});

export const listMyNotifications = query({
  args: {
    organizationId: v.string(),
    unreadOnly: v.optional(v.boolean()),
  },
  returns: v.array(notificationRowValidator),
  handler: async (ctx, args) => {
    const userId = await resolveUserId(ctx, args.organizationId);
    if (args.unreadOnly) {
      return await ctx.db
        .query('userNotifications')
        .withIndex('by_user_org_read', (q) =>
          q
            .eq('userId', userId)
            .eq('organizationId', args.organizationId)
            .eq('read', false),
        )
        .order('desc')
        .take(INBOX_PAGE_CAP);
    }
    return await ctx.db
      .query('userNotifications')
      .withIndex('by_user_org_created', (q) =>
        q.eq('userId', userId).eq('organizationId', args.organizationId),
      )
      .order('desc')
      .take(INBOX_PAGE_CAP);
  },
});

export const myUnreadCount = query({
  args: { organizationId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const userId = await resolveUserId(ctx, args.organizationId);
    const unread = await ctx.db
      .query('userNotifications')
      .withIndex('by_user_org_read', (q) =>
        q
          .eq('userId', userId)
          .eq('organizationId', args.organizationId)
          .eq('read', false),
      )
      .take(INBOX_PAGE_CAP + 1);
    return unread.length;
  },
});

export const markNotificationRead = mutation({
  args: { notificationId: v.id('userNotifications') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.notificationId);
    if (!row) return null;
    const userId = await resolveUserId(ctx, row.organizationId);
    if (row.userId !== userId) throw new Error('NOTIFICATION_FORBIDDEN');
    if (!row.read) {
      await ctx.db.patch(args.notificationId, {
        read: true,
        readAt: Date.now(),
      });
    }
    return null;
  },
});

export const markAllNotificationsRead = mutation({
  args: { organizationId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const userId = await resolveUserId(ctx, args.organizationId);
    const unread = await ctx.db
      .query('userNotifications')
      .withIndex('by_user_org_read', (q) =>
        q
          .eq('userId', userId)
          .eq('organizationId', args.organizationId)
          .eq('read', false),
      )
      .take(500);
    const now = Date.now();
    for (const row of unread) {
      await ctx.db.patch(row._id, { read: true, readAt: now });
    }
    return unread.length;
  },
});
