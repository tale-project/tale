import { v } from 'convex/values';

import { api } from '../_generated/api';
import { action } from '../_generated/server';

export const generateUploadUrl = action({
  args: {},
  returns: v.string(),
  handler: async (ctx): Promise<string> => {
    return await ctx.runMutation(api.files.mutations.generateUploadUrl, {});
  },
});
