import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { v } from 'convex/values';

import { internal } from '../_generated/api';
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

    // Resolve fast/chat model from provider files
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

    return improveMessageHandler(ctx, {
      ...args,
      languageModel,
    });
  },
});
