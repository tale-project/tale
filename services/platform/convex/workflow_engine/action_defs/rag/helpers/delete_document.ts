import { v } from 'convex/values';

import { internal } from '../../../../_generated/api';
import { internalAction, type ActionCtx } from '../../../../_generated/server';
import type { RagDeleteResult } from './types';

export interface DeleteDocumentByIdArgs {
  orgSlug: string;
  fileId: string;
}

/**
 * Delete a document from the knowledge corpus by id, scoped to `orgSlug`.
 *
 * Rewired from the external RAG service (`DELETE /api/v1/documents/{id}`) to the
 * in-process `internal.rag.documents.deleteDocument` action, which deletes the
 * `documents` row + its chunks from the knowledge-db within the org's namespace.
 *
 * The in-process delete is INHERENTLY idempotent: a missing document returns
 * `{ success: true, deleted_count: 0 }` (no 404 to special-case), so retention
 * re-runs and cascade purges stay safe to repeat. Any thrown error (e.g. a
 * transient knowledge-db fault, surfaced via the action's own `withRetry`) is
 * folded into a structured `{ success: false }` result so batch callers don't
 * abort the whole loop on a single bad fileId — except that, unlike the HTTP
 * path, there is no longer a distinct retryable-vs-permanent signal to
 * propagate (the in-process pool already retries transient faults internally).
 */
export async function deleteDocumentById(
  ctx: ActionCtx,
  { orgSlug, fileId }: DeleteDocumentByIdArgs,
): Promise<RagDeleteResult> {
  const startTime = Date.now();

  try {
    const result = await ctx.runAction(internal.rag.documents.deleteDocument, {
      orgSlug,
      fileId,
    });

    return {
      success: result.success,
      deletedCount: result.deleted_count,
      deletedDataIds: result.deleted_data_ids,
      message: result.message,
      processingTimeMs: result.processing_time_ms,
      timestamp: Date.now(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      deletedCount: 0,
      deletedDataIds: [],
      message: errorMessage,
      error: errorMessage,
      processingTimeMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }
}

/**
 * Scheduler-friendly wrapper around `deleteDocumentById` that fans out over a
 * list of fileIds. Cascading thread deletes that need to purge knowledge-corpus
 * vector chunks schedule this action with the storageIds of the chat-upload
 * files they removed. Best-effort: failures per file log but do not abort the
 * batch. Round-2 review CRITICAL #17.
 *
 * Per-tenant: `orgSlug` is required so the per-org corpus namespace is targeted.
 * All `fileIds` in a single call MUST belong to that org.
 */
export const deleteFromRagBatch = internalAction({
  args: {
    orgSlug: v.string(),
    fileIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const fileId of args.fileIds) {
      try {
        const result = await deleteDocumentById(ctx, {
          orgSlug: args.orgSlug,
          fileId,
        });
        if (!result.success) {
          console.warn(
            `[deleteFromRagBatch] delete failed for ${fileId}:`,
            result.error ?? result.message,
          );
        }
      } catch (err) {
        console.warn(
          `[deleteFromRagBatch] error on ${fileId}; skipping:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    return null;
  },
});
