import { v } from 'convex/values';

import {
  getString,
  getNumber,
  getBoolean,
  getArray,
  isRecord,
} from '../../../../../lib/utils/type-guards';
import { internalAction } from '../../../../_generated/server';
import { ragFetch } from '../../../../lib/helpers/rag_config';
import type { RagDeleteResult } from './types';

export interface DeleteDocumentByIdArgs {
  fileId: string;
  timeoutMs?: number;
}

/**
 * Delete document from RAG service by document ID.
 *
 * This calls the RAG service's DELETE endpoint with the document ID.
 * The document ID should match the ID that was used when uploading
 * the document (recordId from the platform).
 */
export async function deleteDocumentById({
  fileId,
  timeoutMs = 60000,
}: DeleteDocumentByIdArgs): Promise<RagDeleteResult> {
  const startTime = Date.now();

  try {
    const response = await ragFetch(
      `/api/v1/documents/${encodeURIComponent(fileId)}`,
      { method: 'DELETE', timeoutMs },
    );

    // Round-2 review HIGH: 404 means the document was already deleted
    // — treat as a successful no-op so retention re-runs and cascade
    // RAG purges are idempotent. Without this, a previously-purged
    // document would surface as `success: false` on every subsequent
    // run, producing a permanent failure indicator on retention
    // receipts that operators cannot clear.
    if (response.status === 404) {
      return {
        success: true,
        deletedCount: 0,
        deletedDataIds: [],
        message: 'already_deleted',
        processingTimeMs: Date.now() - startTime,
        timestamp: Date.now(),
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`RAG service error: ${response.status} ${errorText}`);
    }

    const rawResult: unknown = await response.json();
    const result = isRecord(rawResult) ? rawResult : {};

    const deletedDataIdsRaw = getArray(result, 'deleted_data_ids');
    const deletedDataIds = deletedDataIdsRaw
      ? deletedDataIdsRaw.filter((id): id is string => typeof id === 'string')
      : [];

    return {
      success: getBoolean(result, 'success') ?? false,
      deletedCount: getNumber(result, 'deleted_count') || 0,
      deletedDataIds,
      message: getString(result, 'message') || '',
      processingTimeMs:
        getNumber(result, 'processing_time_ms') || Date.now() - startTime,
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
 * Scheduler-friendly wrapper around `deleteDocumentById` that fans out
 * over a list of fileIds. Mutations cannot reach the RAG service
 * directly (HTTP requires an action context), so cascading thread
 * deletes that need to purge RAG-side vector chunks schedule this
 * action with the storageIds of the chat-upload files they removed.
 * Best-effort: failures per file log but do not abort the batch.
 * Round-2 review CRITICAL #17.
 */
export const deleteFromRagBatch = internalAction({
  args: {
    fileIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    for (const fileId of args.fileIds) {
      const result = await deleteDocumentById({ fileId });
      if (!result.success) {
        console.warn(
          `[deleteFromRagBatch] delete failed for ${fileId}:`,
          result.error ?? result.message,
        );
      }
    }
    return null;
  },
});
