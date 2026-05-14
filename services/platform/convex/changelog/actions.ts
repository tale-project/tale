import { v } from 'convex/values';

import { action } from '../_generated/server';
import { githubReleasesCache } from '../lib/action_cache';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

const releaseShape = v.object({
  tag: v.string(),
  version: v.string(),
  name: v.union(v.string(), v.null()),
  body: v.union(v.string(), v.null()),
  htmlUrl: v.string(),
  publishedAt: v.union(v.string(), v.null()),
});

export const listReleases = action({
  args: {},
  returns: v.array(releaseShape),
  handler: async (ctx) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }
    return await githubReleasesCache.fetch(ctx, {});
  },
});
