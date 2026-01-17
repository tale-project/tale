/**
 * Files Queries
 *
 * Public queries for file operations.
 */

import { v } from 'convex/values';
import { query } from '../_generated/server';

/**
 * Get a file URL from a storage ID.
 */
export const getFileUrl = query({
  args: {
    fileId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    try {
      const url = await ctx.storage.getUrl(args.fileId as any);
      return url;
    } catch {
      return null;
    }
  },
});
