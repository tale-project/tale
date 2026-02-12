import { v } from 'convex/values';

import { api } from '../_generated/api';
import { action } from '../_generated/server';

export const createChatThread = action({
  args: {
    organizationId: v.string(),
    title: v.optional(v.string()),
    chatType: v.optional(
      v.union(
        v.literal('general'),
        v.literal('workflow_assistant'),
        v.literal('agent_test'),
      ),
    ),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    return await ctx.runMutation(api.threads.mutations.createChatThread, args);
  },
});
