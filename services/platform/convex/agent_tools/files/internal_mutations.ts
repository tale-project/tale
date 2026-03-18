'use node';

/**
 * Internal actions for appending generated file parts to agent messages.
 * Called from file generation tool handlers after a successful generate operation.
 */

import { saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components, internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';

/**
 * Append a generated file as a file part on the current assistant message.
 * This saves a new assistant message at the same `order` as the prompt message,
 * which the SDK's toUIMessages groups into the same UIMessage — making the file
 * appear as a downloadable card in the chat UI alongside the agent's text response.
 */
export const appendGeneratedFilePart = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    downloadUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      promptMessageId: args.promptMessageId,
      message: {
        role: 'assistant',
        content: [
          {
            type: 'file',
            mimeType: args.mimeType,
            data: args.downloadUrl,
            filename: args.fileName,
          },
        ],
      },
    });
    return null;
  },
});

/**
 * Register a generated file in file_metadata so it can be tracked,
 * then append it as a file part on the current assistant message.
 */
export const registerAndAppendGeneratedFile = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    organizationId: v.string(),
    storageId: v.id('_storage'),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    downloadUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(
      internal.file_metadata.internal_mutations.saveFileMetadata,
      {
        organizationId: args.organizationId,
        storageId: args.storageId,
        fileName: args.fileName,
        contentType: args.mimeType,
        size: args.size,
      },
    );

    await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      promptMessageId: args.promptMessageId,
      message: {
        role: 'assistant',
        content: [
          {
            type: 'file',
            mimeType: args.mimeType,
            data: args.downloadUrl,
            filename: args.fileName,
          },
        ],
      },
    });
    return null;
  },
});
