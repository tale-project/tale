import { v } from 'convex/values';

import { internalMutation } from '../../_generated/server';
import { onChatComplete as onChatCompleteHelper } from './on_chat_complete';

export const onChatComplete = internalMutation({
  args: {
    result: v.object({
      threadId: v.string(),
      text: v.string(),
      model: v.string(),
      provider: v.string(),
      totalTokens: v.optional(v.number()),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      reasoningTokens: v.optional(v.number()),
      stepCount: v.optional(v.number()),
      finishReason: v.optional(v.string()),
      durationMs: v.optional(v.number()),
      timeToFirstTokenMs: v.optional(v.number()),
      usage: v.optional(
        v.object({
          inputTokens: v.optional(v.number()),
          outputTokens: v.optional(v.number()),
          totalTokens: v.optional(v.number()),
          reasoningTokens: v.optional(v.number()),
          cachedInputTokens: v.optional(v.number()),
        }),
      ),
      toolCalls: v.optional(
        v.array(
          v.object({
            toolName: v.string(),
            status: v.string(),
          }),
        ),
      ),
      reasoning: v.optional(v.string()),
      subAgentUsage: v.optional(
        v.array(
          v.object({
            toolName: v.string(),
            model: v.optional(v.string()),
            provider: v.optional(v.string()),
            inputTokens: v.optional(v.number()),
            outputTokens: v.optional(v.number()),
            totalTokens: v.optional(v.number()),
          }),
        ),
      ),
      contextWindow: v.optional(v.string()),
      contextStats: v.optional(
        v.object({
          totalTokens: v.number(),
          messageCount: v.number(),
          approvalCount: v.number(),
          hasSummary: v.optional(v.boolean()),
          hasRag: v.boolean(),
          hasIntegrations: v.boolean(),
        }),
      ),
    }),
  },
  handler: async (ctx, args) => {
    return await onChatCompleteHelper(ctx, args);
  },
});
