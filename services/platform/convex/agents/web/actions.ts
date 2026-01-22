'use node';

/**
 * Web Agent Convex Actions
 *
 * Public and internal action entry points for the Web Agent.
 * These can be called directly (independent mode) or via the web_assistant tool.
 */

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { generateWebResponse } from './generate_response';

/**
 * Internal action to generate a web agent response.
 *
 * Called by the web_assistant tool or can be scheduled directly.
 */
export const generateResponse = internalAction({
  args: {
    threadId: v.string(),
    userId: v.optional(v.string()),
    organizationId: v.string(),
    taskDescription: v.string(),
    additionalContext: v.optional(v.record(v.string(), v.string())),
    parentThreadId: v.optional(v.string()),
  },
  returns: v.object({
    text: v.string(),
    usage: v.optional(
      v.object({
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        totalTokens: v.optional(v.number()),
      }),
    ),
    finishReason: v.optional(v.string()),
    durationMs: v.number(),
  }),
  handler: async (ctx, args) => {
    return generateWebResponse({
      ctx,
      threadId: args.threadId,
      userId: args.userId,
      organizationId: args.organizationId,
      taskDescription: args.taskDescription,
      additionalContext: args.additionalContext,
      parentThreadId: args.parentThreadId,
    });
  },
});
