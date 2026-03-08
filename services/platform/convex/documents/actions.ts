'use node';

import { v } from 'convex/values';

import { isRecord, getBoolean } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { ragAction } from '../workflow_engine/action_defs/rag/rag_action';

export const retryRagIndexing = action({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      const authUser = await authComponent.getAuthUser(ctx);
      if (!authUser) {
        return { success: false, error: 'Unauthenticated' };
      }

      const document = await ctx.runQuery(
        internal.documents.internal_queries.getDocumentByIdRaw,
        { documentId: args.documentId },
      );

      if (!document) {
        return { success: false, error: 'Document not found' };
      }

      if (!document.fileId) {
        return { success: false, error: 'Document has no file' };
      }

      const rawResult = await ragAction.execute(
        ctx,
        {
          operation: 'upload_document',
          fileId: document.fileId,
          fileName: document.title,
          contentType: document.mimeType,
        },
        {},
      );
      const result = isRecord(rawResult) ? rawResult : undefined;
      const success = result ? (getBoolean(result, 'success') ?? false) : false;

      return { success };
    } catch (error) {
      console.error('[retryRagIndexing] Error:', error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to retry RAG indexing',
      };
    }
  },
});
