/**
 * Members Queries
 *
 * Internal queries for member operations.
 * Member data is stored in Better Auth's `member` table.
 */

import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';

/**
 * Get a member's role in an organization (internal query)
 * Returns the role string or null if the member doesn't exist
 */
export const getMemberRoleInternal = internalQuery({
  args: {
    userId: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const member = await ctx.db
      .query('member')
      .withIndex('organizationId_userId', (q) =>
        q.eq('organizationId', args.organizationId).eq('userId', args.userId),
      )
      .unique();

    return member?.role ?? null;
  },
});
