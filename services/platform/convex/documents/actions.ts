'use node';

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import {
  RateLimitExceededError,
  checkUserRateLimit,
} from '../lib/rate_limiter/helpers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

// Matches the RAG watchdog's stale threshold (> the 30-min Convex action
// ceiling). A `running`/`queued` row younger than this has a live indexing
// job; a retry would double-index against the shared knowledge-db pool. Older
// than this, the in-flight job is dead (Convex killed it) and the watchdog
// hasn't swept yet — allow the user to self-recover immediately.
const IN_FLIGHT_STALE_MS = 35 * 60 * 1000;

/**
 * The user-triggered "Retry"/"Reindex" affordance (`RagStatusBadge`,
 * `DocumentRowActions`, `project-files-tab.tsx`): re-queue the document's
 * blob and dispatch it through the same concurrency caps as an upload.
 *
 * Returns its established `{ success, error? }` shape (never throws): the
 * frontend's blanket `catch` for a thrown error shows a message-less toast,
 * while the `success: false` path shows the actual `error` string.
 */
export const retryRagIndexing = action({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  // The explicit return annotation is load-bearing: without it TS infers the
  // handler's type THROUGH the `internal.*` dereferences below, closes the
  // self-referential api-type loop, and the generated api collapses to `any`
  // deployment-wide (~400 downstream implicit-any errors).
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return { success: false, error: 'Unauthenticated' };
    }

    // Throttle retries per user: mashing "Retry" on several large docs
    // otherwise fires concurrent heavy jobs at the shared knowledge-db pool.
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

    // Terminal, non-retryable status guard: 'unsupported' means no text
    // extractor exists for this format — a retry can only reproduce the same
    // rejection. The UI hides the affordance for it, but this is a public
    // action with no client-side gate of its own.
    const fileMetadata = await ctx.runQuery(
      internal.file_metadata.internal_queries.getByStorageId,
      { storageId: document.fileId },
    );
    if (fileMetadata?.ragStatus === 'unsupported') {
      return {
        success: false,
        error:
          fileMetadata.ragError ??
          "This file type has no text extractor and can't be indexed for RAG search.",
      };
    }

    // In-flight guard: a `running` (or freshly `queued`) row already has a
    // live indexing job — re-queueing now would double-index the same file.
    // Past the watchdog's stale threshold the prior job is dead, so a retry
    // is the user's fast path to recovery (before the 5-min cron).
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

    // Self-heal the canonical RAG-status home before re-queueing:
    // `requeueFileForRagIndexing` no-ops when the blob has no fileMetadata
    // row (a legacy file-backed doc), which would leave this retry silently
    // stuck.
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

    await ctx.runMutation(
      internal.file_metadata.internal_mutations.requeueFileForRagIndexing,
      { storageId: document.fileId },
    );

    return { success: true };
  },
});
