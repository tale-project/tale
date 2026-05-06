import {
  getString,
  getNumber,
  getBoolean,
  getArray,
  isRecord,
} from '../../../../../lib/utils/type-guards';
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
