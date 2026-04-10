import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import { resolveLanguageModelWithFallback } from '../../providers/failover';
import { autoSummarizeIfNeededModel } from './auto_summarize';

export const autoSummarizeIfNeeded = internalAction({
  args: {
    threadId: v.string(),
  },
  returns: v.object({
    summarized: v.boolean(),
    existingSummary: v.optional(v.string()),
    newMessageCount: v.number(),
    totalMessagesSummarized: v.number(),
  }),
  handler: async (ctx, args) => {
    // Resolve chat model from provider files
    const { languageModel } = await resolveLanguageModelWithFallback(ctx, {
      tag: 'chat',
    });

    return await autoSummarizeIfNeededModel(ctx, {
      ...args,
      languageModel,
    });
  },
});
