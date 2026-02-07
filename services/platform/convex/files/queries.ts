/**
 * Files Queries
 *
 * Public queries for file operations.
 */

import { v } from 'convex/values';
import { query } from '../_generated/server';
import { authComponent } from '../auth';

/**
 * Get a file URL from a storage ID.
 */
export const getFileUrl = query({
  args: {
    fileId: v.id('_storage'),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return null;

    try {
      const url = await ctx.storage.getUrl(args.fileId);
      return url;
    } catch {
      return null;
    }
  },
});
