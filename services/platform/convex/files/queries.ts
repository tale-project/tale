import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';

export const getFileUrl = query({
  args: {
    fileId: v.id('_storage'),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    try {
      return await ctx.storage.getUrl(args.fileId);
    } catch {
      return null;
    }
  },
});
