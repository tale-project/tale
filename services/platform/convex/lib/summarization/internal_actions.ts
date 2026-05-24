import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import { resolveLanguageModelWithFallback } from '../../providers/failover';
import { autoSummarizeIfNeededModel } from './auto_summarize';

export const autoSummarizeIfNeeded = internalAction({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
  },
  returns: v.object({
    summarized: v.boolean(),
    existingSummary: v.optional(v.string()),
    newMessageCount: v.number(),
    totalMessagesSummarized: v.number(),
  }),
  handler: async (ctx, args) => {
    const { languageModel, modelData } = await resolveLanguageModelWithFallback(
      ctx,
      {
        tag: 'chat',
        organizationId: args.organizationId,
      },
    );

    return await autoSummarizeIfNeededModel(ctx, {
      threadId: args.threadId,
      languageModel,
      modelData,
    });
  },
});
