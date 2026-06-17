'use node';

import { v } from 'convex/values';

import { isRecord, getBoolean, getString } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
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
    // RAG status is canonical on fileMetadata.ragStatus; hoist storageId so the
    // catch can mark failure after the document is resolved.
    let storageId: Id<'_storage'> | null = null;
    try {
      const authUser = await getAuthUserIdentity(ctx);
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

      const isMember = await ctx.runQuery(
        internal.documents.internal_queries.verifyOrganizationMembership,
        {
          organizationId: document.organizationId,
          userId: authUser.userId,
        },
      );
      if (!isMember) {
        return { success: false, error: 'Unauthorized' };
      }

      if (!document.fileId) {
        return { success: false, error: 'Document has no file' };
      }
      storageId = document.fileId;

      // Self-heal the canonical RAG-status home before writing status:
      // updateFileRagStatus below no-ops when the blob has no fileMetadata row
      // (e.g. a UI upload without fileSize, or a legacy file-backed doc), which
      // would leave this retry silently stuck. Does not schedule another upload
      // — this action pushes the blob itself just below.
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.ensureFileMetadataForDocument,
        {
          organizationId: document.organizationId,
          storageId: document.fileId,
          documentId: args.documentId,
          fileName: document.title ?? 'document',
          contentType: document.mimeType,
        },
      );

      const rawResult = await ragAction.execute(
        ctx,
        {
          operation: 'upload_document',
          fileId: document.fileId,
          fileName: document.title,
          contentType: document.mimeType,
        },
        { organizationId: document.organizationId },
      );
      const result = isRecord(rawResult) ? rawResult : undefined;
      const success = result ? (getBoolean(result, 'success') ?? false) : false;

      if (success) {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          { storageId: document.fileId, ragStatus: 'queued' },
        );
        await ctx.scheduler.runAfter(
          INITIAL_POLLING_DELAY_MS,
          internal.file_metadata.internal_actions.pollFileRagStatus,
          {
            storageId: document.fileId,
            organizationId: document.organizationId,
            attempt: 1,
          },
        );
      } else {
        const error =
          (result ? getString(result, 'error') : undefined) ??
          'Upload to RAG failed';
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          { storageId: document.fileId, ragStatus: 'failed', ragError: error },
        );
      }

      return { success };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to retry RAG indexing';
      console.error('[retryRagIndexing] Error:', error);
      if (storageId) {
        try {
          await ctx.runMutation(
            internal.file_metadata.internal_mutations.updateFileRagStatus,
            { storageId, ragStatus: 'failed', ragError: message },
          );
        } catch (updateError) {
          console.error(
            '[retryRagIndexing] Failed to update document status:',
            updateError,
          );
        }
      }
      return { success: false, error: message };
    }
  },
});
