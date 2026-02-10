'use node';

/**
 * Internal actions for custom agent hooks.
 *
 * Provides a beforeGenerate hook that preprocesses file attachments
 * (documents, images, text files) so the AI can answer directly from
 * pre-analyzed content instead of relying on tool calls.
 */

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import { processAttachments } from '../lib/attachments';
import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_CUSTOM_AGENT', '[CustomAgentHooks]');

export const beforeGenerateHook = internalAction({
  args: {
    threadId: v.string(),
    promptMessage: v.string(),
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
    contextMessagesTokens: v.number(),
  },
  returns: v.object({
    promptContent: v.optional(v.any()),
    contextExceedsBudget: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { promptMessage, attachments } = args;

    const { promptContent } = await processAttachments(
      ctx,
      attachments ?? [],
      promptMessage,
      { debugLog, toolName: 'custom_agent' },
    );

    return {
      promptContent,
      contextExceedsBudget: false,
    };
  },
});
