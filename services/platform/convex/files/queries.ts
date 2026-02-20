import { v } from 'convex/values';

import { MAX_BATCH_FILE_IDS } from '../../lib/shared/file-types';
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

export const getFileUrls = query({
  args: {
    fileIds: v.array(v.id('_storage')),
  },
  returns: v.array(
    v.object({
      fileId: v.id('_storage'),
      url: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    const fileIds = args.fileIds.slice(0, MAX_BATCH_FILE_IDS);

    const results = await Promise.all(
      fileIds.map(async (fileId) => {
        try {
          const url = await ctx.storage.getUrl(fileId);
          return { fileId, url };
        } catch {
          return { fileId, url: null };
        }
      }),
    );

    return results;
  },
});
