import { v } from 'convex/values';

import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { improveMessage as improveMessageHandler } from './improve_message';

export const improveMessage = action({
  args: {
    originalMessage: v.string(),
    instruction: v.optional(v.string()),
  },
  returns: v.object({
    improvedMessage: v.string(),
    error: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ improvedMessage: string; error?: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return improveMessageHandler(ctx, args);
  },
});
