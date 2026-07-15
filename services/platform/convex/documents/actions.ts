'use node';

import { v } from 'convex/values';

import { isRecord, getBoolean, getString } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action } from '../_generated/server';
import {
  RateLimitExceededError,
  checkUserRateLimit,
} from '../lib/rate_limiter/helpers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { ragAction } from '../workflow_engine/action_defs/rag/rag_action';

const INITIAL_POLLING_DELAY_MS = 10_000;

// Matches the RAG watchdog's stale threshold (> the 30-min Convex action
// ceiling). A `running`/`queued` row younger than this has a live indexing
// job; a retry would double-index against the shared knowledge-db pool. Older
// than this, the in-flight job is dead (Convex killed it) and the watchdog
// hasn't swept yet — allow the user to self-recover immediately.
const IN_FLIGHT_STALE_MS = 35 * 60 * 1000;

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

      // Throttle retries per user. Re-indexing runs the full synchronous
      // extract/chunk/embed inline in this public action; mashing "Retry" on
      // several large docs otherwise fires concurrent heavy jobs at the shared
      // knowledge-db pool. The `file:rag-retry` bucket (10/min) existed but was
      // never wired.
      try {
        await checkUserRateLimit(ctx, 'file:rag-retry', authUser.userId);
      } catch (error) {
        if (error instanceof RateLimitExceededError) {
          return { success: false, error: error.message };
        }
        throw error;
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

      // Terminal, non-retryable status guard: 'unsupported' means no text
      // extractor exists for this format — a retry can only reproduce the
      // same rejection. The two UI entry points already hide the "Reindex"
      // affordance for it (`DocumentRowActions`, `RagStatusBadge`, #2598),
      // but this is a public action with no client-side gate of its own, so a
      // stale tab or a scripted caller could still reach it directly. Checked
      // BEFORE `ensureFileMetadataForDocument`/`ragAction.execute` so a
      // terminal file is never re-queued or bounced through 'failed'.
      const fileMetadata = await ctx.runQuery(
        internal.file_metadata.internal_queries.getByStorageId,
        { storageId: document.fileId },
      );
      if (fileMetadata?.ragStatus === 'unsupported') {
        return {
          success: false,
          error:
            "This file type has no text extractor and can't be indexed for RAG search. Convert it to a supported format (PDF, DOCX, TXT, …) and re-upload.",
        };
      }

      // In-flight guard: a `running` (or freshly `queued`) row already has a
      // live indexing job — re-running `ragAction.execute` now would index the
      // same file twice concurrently. Only block while the job could still be
      // alive; past the watchdog's stale threshold the prior job is dead, so a
      // retry is the user's fast path to recovery (before the 5-min cron).
      if (
        fileMetadata &&
        (fileMetadata.ragStatus === 'running' ||
          fileMetadata.ragStatus === 'queued')
      ) {
        const clock = fileMetadata.ragQueuedAt ?? fileMetadata._creationTime;
        if (Date.now() - clock < IN_FLIGHT_STALE_MS) {
          return {
            success: false,
            error: 'Indexing is already in progress for this file.',
          };
        }
      }

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
