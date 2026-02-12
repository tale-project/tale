import { v } from 'convex/values';

import { api } from '../_generated/api';
import { action } from '../_generated/server';

export const chatWithCustomAgent = action({
  args: {
    customAgentId: v.id('customAgents'),
    threadId: v.string(),
    organizationId: v.string(),
    message: v.string(),
    maxSteps: v.optional(v.number()),
    attachments: v.optional(
      v.array(
        v.object({
          fileId: v.id('_storage'),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
  },
  returns: v.object({
    messageAlreadyExists: v.boolean(),
    streamId: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ messageAlreadyExists: boolean; streamId: string }> => {
    return await ctx.runMutation(
      api.custom_agents.chat.chatWithCustomAgent,
      args,
    );
  },
});
