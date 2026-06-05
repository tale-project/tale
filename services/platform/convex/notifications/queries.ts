import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

const notificationDocValidator = v.object({
  _id: v.id('notifications'),
  _creationTime: v.number(),
  organizationId: v.string(),
  category: v.union(v.literal('security'), v.literal('system')),
  severity: v.union(
    v.literal('info'),
    v.literal('warning'),
    v.literal('critical'),
  ),
  titleKey: v.string(),
  bodyKey: v.string(),
  params: v.optional(v.any()),
  createdAt: v.number(),
  readBy: v.array(v.string()),
  read: v.boolean(),
});

/**
 * Paginated list of notifications for the caller's organization. Each row
 * is decorated with `read: boolean` reflecting whether the current user
 * has dismissed it.
 */
export const list = query({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(notificationDocValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    // Membership check throws if the caller isn't part of the org.
    await getOrganizationMember(ctx, args.organizationId, authUser);
    const userId = authUser.userId;

    const result = await ctx.db
      .query('notifications')
      .withIndex('by_org_created', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')
      .paginate(args.paginationOpts);

    // The full page is returned with a per-row `read` flag; the Unread/All
    // filter is applied client-side so toggling it never changes the query
    // arguments (which would reset pagination and re-flash the skeleton).
    const page = result.page.map((n) => ({
      _id: n._id,
      _creationTime: n._creationTime,
      organizationId: n.organizationId,
      category: n.category,
      severity: n.severity,
      titleKey: n.titleKey,
      bodyKey: n.bodyKey,
      params: n.params,
      createdAt: n.createdAt,
      readBy: n.readBy,
      read: n.readBy.includes(userId),
    }));

    return {
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      page,
    };
  },
});

/**
 * Count of notifications in this org that the caller has not dismissed.
 * Bounded by the implicit Convex query cap; for the realistic admin-bell
 * use case (≤ a few hundred lifetime notifications per org) that's fine.
 */
export const unreadCount = query({
  args: { organizationId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return 0;
    // Membership check throws if the caller isn't part of the org — mirrors
    // `list`/`markAllRead`. Without it any authenticated user could read an
    // arbitrary org's unread count by passing its id.
    await getOrganizationMember(ctx, args.organizationId, authUser);
    const userId = authUser.userId;
    let count = 0;
    for await (const n of ctx.db
      .query('notifications')
      .withIndex('by_org_created', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (!n.readBy.includes(userId)) count++;
    }
    return count;
  },
});
