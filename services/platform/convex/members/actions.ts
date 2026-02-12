import { v } from 'convex/values';

import { api } from '../_generated/api';
import { action } from '../_generated/server';
import { memberRoleValidator } from './validators';

export const addMember = action({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    role: v.optional(memberRoleValidator),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    return await ctx.runMutation(api.members.mutations.addMember, args);
  },
});
