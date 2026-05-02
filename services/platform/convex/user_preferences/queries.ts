import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { assertSelfAndOrgMember } from '../lib/rls/auth/assert_self_and_org_member';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';

export const getMyPreferences = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'userPreferences'> | null> => {
    const authUser = await requireAuthenticatedUser(ctx);
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      args.organizationId,
    );

    return await ctx.db
      .query('userPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q
          .eq('userId', authUser.userId)
          .eq('organizationId', args.organizationId),
      )
      .first();
  },
});
