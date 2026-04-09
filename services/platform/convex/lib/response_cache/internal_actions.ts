'use node';

import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import { storeSemanticCache } from './semantic_cache';

export const storeSemanticCacheAsync = internalAction({
  args: {
    agentName: v.string(),
    model: v.string(),
    userMessage: v.string(),
    responseText: v.string(),
    provider: v.optional(v.string()),
    usage: v.optional(
      v.object({
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        totalTokens: v.optional(v.number()),
      }),
    ),
    userId: v.optional(v.string()),
    organizationId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    await storeSemanticCache({
      agentName: args.agentName,
      model: args.model,
      userMessage: args.userMessage,
      responseText: args.responseText,
      provider: args.provider,
      usage: args.usage,
      userId: args.userId,
      organizationId: args.organizationId,
    });
  },
});
