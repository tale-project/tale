import { v } from 'convex/values';

import { api } from '../../_generated/api';
import { action } from '../../_generated/server';

export const chatWithAgent = action({
  args: {
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
  handler: async (ctx, args) => {
    return await ctx.runMutation(api.agents.chat.mutations.chatWithAgent, args);
  },
});
