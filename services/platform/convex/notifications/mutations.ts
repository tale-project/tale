import { v } from 'convex/values';

import { internalMutation, mutation } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { writeNotificationForOrgs } from './helpers';

/**
 * Append the calling user to a notification's `readBy` set. Idempotent —
 * repeated calls are no-ops once the user is recorded.
 */
export const markRead = mutation({
  args: { notificationId: v.id('notifications') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const notification = await ctx.db.get(args.notificationId);
    if (!notification) return null;

    // Authorization: caller must be a member of the notification's org.
    await getOrganizationMember(ctx, notification.organizationId, authUser);

    const userId = authUser.userId;
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await getOrganizationMember(ctx, args.organizationId, authUser);

    const userId = authUser.userId;
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

/**
 * Org-bell entry written by an AUTOMATION (the workflow `notification`
 * action's `notify_org_channel` op). Thin internal wrapper over
 * `writeNotificationForOrgs` so workflows get the same in-app feed the
 * security/system emitters use. `titleKey`/`bodyKey` are i18n keys.
 */
export const writeOrgNotification = internalMutation({
  args: {
    organizationId: v.string(),
    severity: v.union(
      v.literal('info'),
      v.literal('warning'),
      v.literal('critical'),
    ),
    titleKey: v.string(),
    bodyKey: v.string(),
    params: v.optional(v.record(v.string(), v.any())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await writeNotificationForOrgs(ctx, {
      organizationIds: [args.organizationId],
      category: 'system',
      severity: args.severity,
      titleKey: args.titleKey,
      bodyKey: args.bodyKey,
      params: args.params,
    });
    return null;
  },
});
