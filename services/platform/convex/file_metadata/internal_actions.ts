'use node';

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import { getRagConfig } from '../lib/helpers/rag_config';
import { ragAction } from '../workflow_engine/action_defs/rag/rag_action';

/**
 * Upload a file to the RAG service for indexing.
 *
 * This is a lightweight action triggered by saveFileMetadata on new inserts.
 * Unlike uploadDocumentToRag (which tracks status on a document record),
 * this simply fires-and-forgets the RAG upload.
 */
export const uploadFileToRag = internalAction({
  args: {
    storageId: v.string(),
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
    }

    return null;
  },
});
