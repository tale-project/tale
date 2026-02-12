import { v } from 'convex/values';

import { api } from '../_generated/api';
import { action } from '../_generated/server';

export const addMember = action({
  args: {
    teamId: v.string(),
    userId: v.string(),
    organizationId: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    return await ctx.runMutation(api.team_members.mutations.addMember, args);
  },
});
