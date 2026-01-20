/**
 * Chat Agent Mutations
 *
 * Public and internal mutations for chat agent operations.
 */

import { v } from 'convex/values';
import { internalMutation, mutation } from '../_generated/server';
import { chatWithAgent as chatWithAgentHelper } from './chat_with_agent';
import { onChatComplete as onChatCompleteHelper } from './on_chat_complete';
import { authComponent } from '../auth';

export const chatWithAgent = mutation({
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await chatWithAgentHelper(ctx, args);
  },
});

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
            inputTokens: v.optional(v.number()),
            outputTokens: v.optional(v.number()),
            totalTokens: v.optional(v.number()),
          }),
        ),
      ),
    }),
  },
  handler: async (ctx, args) => {
    return await onChatCompleteHelper(ctx, args);
  },
});
