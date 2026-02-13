'use node';

import { v } from 'convex/values';

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
    jobId: v.optional(v.string()),
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

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
      const result = (await ragAction.execute(
        ctx,
        { operation: 'upload_document', recordId: args.documentId },
        {},
      )) as { success: boolean; jobId?: string };

      return { success: result.success, jobId: result.jobId };
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
