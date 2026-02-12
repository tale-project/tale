import { v } from 'convex/values';

import { api } from '../../_generated/api';
import { action } from '../../_generated/server';

export const submitHumanInputResponse = action({
  args: {
    approvalId: v.id('approvals'),
    response: v.union(v.string(), v.array(v.string())),
  },
  returns: v.object({
    success: v.boolean(),
    threadId: v.optional(v.string()),
    streamId: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ success: boolean; threadId?: string; streamId?: string }> => {
    return await ctx.runMutation(
      api.agent_tools.human_input.mutations.submitHumanInputResponse,
      args,
    );
  },
});
