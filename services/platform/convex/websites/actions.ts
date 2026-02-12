import { v } from 'convex/values';

import { api } from '../_generated/api';
import { action } from '../_generated/server';

export const rescanWebsite = action({
  args: {
    websiteId: v.id('websites'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await ctx.runMutation(api.websites.mutations.rescanWebsite, args);
  },
});
