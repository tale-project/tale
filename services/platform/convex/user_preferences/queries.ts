import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalQuery, query } from '../_generated/server';
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

/**
 * One user's sticky chat model pick, for system-internal work done on that
 * user's behalf with no interactive identity — the thread title generation
 * names a conversation with the same model its owner chats with. Null when
 * the user never picked one.
 */
export const getChatModelInternal = internalQuery({
  args: { userId: v.string(), organizationId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('userPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q.eq('userId', args.userId).eq('organizationId', args.organizationId),
      )
      .first();
    return row?.chatModelId ?? null;
  },
});
