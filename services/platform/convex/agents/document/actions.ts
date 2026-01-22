'use node';

/**
 * Document Agent Convex Actions
 *
 * Internal action entry points for the Document Agent.
 * Called by the document_assistant tool.
 */

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { generateDocumentResponse } from './generate_response';

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
    return generateDocumentResponse({
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
