import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { toPublicUrl } from '../lib/helpers/public_storage_url';

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const url = await ctx.storage.generateUploadUrl();
    return toPublicUrl(url);
  },
});
