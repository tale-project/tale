/**
 * File Mutations
 *
 * Public mutations for file storage operations.
 */

import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await ctx.storage.generateUploadUrl();
  },
});
