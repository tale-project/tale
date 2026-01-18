/**
 * OneDrive Queries
 */

import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { getUserTokenLogic } from './get_user_token_logic';

export const getUserToken = internalQuery({
  args: {
    userId: v.string(),
  },
  returns: v.object({
    token: v.union(v.string(), v.null()),
    needsRefresh: v.boolean(),
    accountId: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    return await getUserTokenLogic(ctx, args);
  },
});
