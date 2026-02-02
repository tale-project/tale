/**
 * Routing Agent Mutations
 *
 * Public and internal mutations for routing agent operations.
 */

import { v } from 'convex/values';
import { internalMutation, mutation } from '../../_generated/server';
import { startAgentChat } from '../../lib/agent_chat';
import { onChatComplete as onChatCompleteHelper } from './on_chat_complete';
import { authComponent } from '../../auth';
import {
  CHAT_AGENT_CONFIG,
  getChatAgentRuntimeConfig,
  createChatHookHandles,
} from './config';

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

    // Get runtime config and create FunctionHandles for hooks
    const runtimeConfig = getChatAgentRuntimeConfig();
    const hooks = await createChatHookHandles(ctx);

    return startAgentChat({
      ctx,
      agentType: 'chat',
      threadId: args.threadId,
      organizationId: args.organizationId,
      message: args.message,
      maxSteps: args.maxSteps,
      attachments: args.attachments,
      agentConfig: CHAT_AGENT_CONFIG,
      model: runtimeConfig.model,
      provider: runtimeConfig.provider,
      debugTag: runtimeConfig.debugTag,
      enableStreaming: runtimeConfig.enableStreaming,
      hooks,
    });
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
          hasSummary: v.optional(v.boolean()), // Deprecated, kept for backward compatibility
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
