import { v } from 'convex/values';

import { prepareFileUrlIds } from '../../lib/shared/file-url-batch';
import { query } from '../_generated/server';
import { toPublicUrl } from '../lib/helpers/public_storage_url';
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
      const url = await ctx.storage.getUrl(args.fileId);
      return url ? toPublicUrl(url) : null;
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

    // Dedupe then resolve all — mirrors documents `batchGetStorageUrls`. Never
    // silently truncate: a low product cap used to drop Outcome / thumbnail
    // URLs while titles still rendered.
    const uniqueIds = prepareFileUrlIds(args.fileIds);

    return Promise.all(
      uniqueIds.map(async (fileId) => {
        try {
          const url = await ctx.storage.getUrl(fileId);
          return { fileId, url: url ? toPublicUrl(url) : null };
        } catch {
          return { fileId, url: null };
        }
      }),
    );
  },
});
