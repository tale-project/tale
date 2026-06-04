import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import { toPublicUrl } from '../lib/helpers/public_storage_url';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const url = await ctx.storage.generateUploadUrl();
    return toPublicUrl(url);
  },
});
