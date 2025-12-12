/**
 * Chat Agent domain entrypoint.
 *
 * Thin Convex wrappers around model/chat_agent implementations.
 */

import {
  query,
  mutation,
  internalAction,
  internalMutation,
} from './_generated/server';
import { v } from 'convex/values';
import { runIdValidator, runResultValidator } from '@convex-dev/action-retrier';
import {
  chatWithAgent as chatWithAgentModel,
  chatWithAgentStatus as chatWithAgentStatusModel,
  cancelChat as cancelChatModel,
  generateAgentResponse as generateAgentResponseModel,
  onChatComplete as onChatCompleteModel,
} from './model/chat_agent';
import { autoSummarizeIfNeededModel } from './model/chat_agent/auto_summarize_if_needed';

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
    runId: v.string(),
    messageAlreadyExists: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await chatWithAgentModel(ctx, args);
  },
});

export const chatWithAgentStatus = query({
  args: {
    runId: v.string(),
  },
  returns: v.union(
    v.object({
      status: v.literal('inProgress'),
    }),
    v.object({
      status: v.literal('success'),
      result: v.object({
        threadId: v.string(),
        text: v.string(),
        toolCalls: v.optional(
          v.array(
            v.object({
              toolName: v.string(),
              status: v.string(),
            }),
          ),
        ),
        model: v.string(),
        provider: v.string(),
        usage: v.optional(
          v.object({
            inputTokens: v.optional(v.number()),
            outputTokens: v.optional(v.number()),
            totalTokens: v.optional(v.number()),
            reasoningTokens: v.optional(v.number()),
            cachedInputTokens: v.optional(v.number()),
          }),
        ),
        reasoning: v.optional(v.string()),
      }),
    }),
    v.object({
      status: v.literal('failed'),
      error: v.string(),
    }),
    v.object({
      status: v.literal('canceled'),
    }),
  ),
  handler: async (ctx, args) => {
    return await chatWithAgentStatusModel(ctx, args);
  },
});

export const cancelChat = mutation({
  args: {
    runId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await cancelChatModel(ctx, args);
  },
});

export const generateAgentResponse = internalAction({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    maxSteps: v.number(),
    promptMessageId: v.string(),
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
    messageText: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    text: v.string(),
    toolCalls: v.optional(
      v.array(
        v.object({
          toolName: v.string(),
          status: v.string(),
        }),
      ),
    ),
    model: v.string(),
    provider: v.string(),
    usage: v.optional(
      v.object({
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        totalTokens: v.optional(v.number()),
        reasoningTokens: v.optional(v.number()),
        cachedInputTokens: v.optional(v.number()),
      }),
    ),
    reasoning: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    return await generateAgentResponseModel(ctx, args);
  },
});

export const onChatComplete = internalMutation({
  args: {
    runId: runIdValidator,
    result: runResultValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await onChatCompleteModel(ctx, args as any);
    return null;
  },
});

/**
 * Automatic incremental summarization - thin wrapper that delegates to the
 * model-layer implementation in model/chat_agent/auto_summarize_if_needed.
 */
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
    return await autoSummarizeIfNeededModel(ctx, args);
  },
});
