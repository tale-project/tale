'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { getRagConfig } from '../lib/helpers/rag_config';
import { ragAction } from '../workflow_engine/action_defs/rag/rag_action';

/**
 * Upload a file to the RAG service for indexing.
 *
 * Triggered by saveFileMetadata on new inserts. Only uploads — status
 * polling is driven by the client via checkFileRagStatus.
 */
export const uploadFileToRag = internalAction({
  args: {
    storageId: v.id('_storage'),
    fileName: v.string(),
    contentType: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const ragConfig = getRagConfig();
    if (!ragConfig.serviceUrl) {
      return null;
    }

    try {
      await ragAction.execute(
        ctx,
        {
          operation: 'upload_document',
          fileId: args.storageId,
          fileName: args.fileName,
          contentType: args.contentType,
        },
        {},
      );
    } catch (error) {
      console.error(
        `[uploadFileToRag] Failed to upload file ${args.storageId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.updateFileRagStatus,
        {
          storageId: args.storageId,
          ragStatus: 'failed',
          ragError: error instanceof Error ? error.message : String(error),
        },
      );
    }

    return null;
  },
});
