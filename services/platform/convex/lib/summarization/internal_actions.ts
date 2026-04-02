import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- resolveModelByTag returns v.any() but shape is guaranteed by provider file_actions contract
    const modelData = (await ctx.runAction(
      internal.providers.file_actions.resolveModelByTag,
      { tag: 'chat' },
    )) as {
      providerName: string;
      baseUrl: string;
      apiKey: string;
      modelId: string;
      supportsStructuredOutputs: boolean;
    };
    const provider = createOpenAICompatible({
      name: modelData.providerName,
      baseURL: modelData.baseUrl,
      apiKey: modelData.apiKey,
      supportsStructuredOutputs: modelData.supportsStructuredOutputs,
    });
    const languageModel = provider.chatModel(modelData.modelId);

    return await autoSummarizeIfNeededModel(ctx, {
      ...args,
      languageModel,
    });
  },
});
