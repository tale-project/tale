'use node';

import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { api, internal } from '../_generated/api';
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

      // Execute RAG upload action directly
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

export const createDocumentFromUpload = action({
  args: {
    organizationId: v.string(),
    fileId: v.id('_storage'),
    fileName: v.string(),
    contentType: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
    teamTags: v.optional(v.array(v.string())),
  },
  returns: v.object({
    success: v.boolean(),
    documentId: v.id('documents'),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ success: boolean; documentId: Id<'documents'> }> => {
    return await ctx.runMutation(
      api.documents.mutations.createDocumentFromUpload,
      args,
    );
  },
});

export const generateUploadUrl = action({
  args: {},
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    return await ctx.runMutation(api.files.mutations.generateUploadUrl, args);
  },
});
