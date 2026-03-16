'use node';

import { v } from 'convex/values';

import { isRecord, getBoolean, getString } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { ragAction } from '../workflow_engine/action_defs/rag/rag_action';

const INITIAL_POLLING_DELAY_MS = 10_000;

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

      if (success) {
        await ctx.runMutation(
          internal.documents.internal_mutations.updateDocumentRagInfo,
          {
            documentId: args.documentId,
            ragInfo: {
              status: 'queued',
              indexedFileId: document.fileId,
            },
          },
        );
        await ctx.scheduler.runAfter(
          INITIAL_POLLING_DELAY_MS,
          internal.documents.internal_actions.checkRagDocumentStatus,
          { documentId: args.documentId, attempt: 1 },
        );
      } else {
        const error =
          (result ? getString(result, 'error') : undefined) ??
          'Upload to RAG failed';
        await ctx.runMutation(
          internal.documents.internal_mutations.updateDocumentRagInfo,
          {
            documentId: args.documentId,
            ragInfo: { status: 'failed', error },
          },
        );
      }

      return { success };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to retry RAG indexing';
      console.error('[retryRagIndexing] Error:', error);
      try {
        await ctx.runMutation(
          internal.documents.internal_mutations.updateDocumentRagInfo,
          {
            documentId: args.documentId,
            ragInfo: { status: 'failed', error: message },
          },
        );
      } catch (updateError) {
        console.error(
          '[retryRagIndexing] Failed to update document status:',
          updateError,
        );
      }
      return { success: false, error: message };
    }
  },
});
