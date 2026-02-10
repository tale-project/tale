import type { RagDeleteResult } from './types';

import {
  getString,
  getNumber,
  getBoolean,
  getArray,
  isRecord,
} from '../../../../../lib/utils/type-guards';

export interface DeleteDocumentByIdArgs {
  ragServiceUrl: string;
  documentId: string;
  mode?: 'soft' | 'hard';
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
  ragServiceUrl,
  documentId,
  mode = 'hard',
  timeoutMs = 60000,
}: DeleteDocumentByIdArgs): Promise<RagDeleteResult> {
  const startTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Call the delete endpoint with document ID
    const url = `${ragServiceUrl}/api/v1/documents/${encodeURIComponent(documentId)}?mode=${mode}`;
    const response = await fetch(url, {
      method: 'DELETE',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

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
    clearTimeout(timeoutId);
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
