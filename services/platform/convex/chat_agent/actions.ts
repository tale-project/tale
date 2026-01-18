'use node';

/**
 * Chat Agent Actions
 *
 * Internal actions for chat agent operations.
 */

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { generateAgentResponse as generateAgentResponseHelper } from './generate_agent_response';
import { autoSummarizeIfNeededModel } from './auto_summarize_if_needed';

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
    messageText: v.string(),
    streamId: v.string(),
    userId: v.optional(v.string()),
    userTeamIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    return await generateAgentResponseHelper(ctx, args);
  },
});

export const autoSummarizeIfNeeded = internalAction({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    return await autoSummarizeIfNeededModel(ctx, args);
  },
});
