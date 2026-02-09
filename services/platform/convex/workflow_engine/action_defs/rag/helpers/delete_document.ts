import type { RagDeleteResult } from './types';

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

    const result = (await response.json()) as Record<string, unknown>;

    return {
      success: (result.success as boolean | undefined) ?? false,
      deletedCount: (result.deleted_count as number) || 0,
      deletedDataIds: (result.deleted_data_ids as Array<string>) || [],
      message: (result.message as string) || '',
      processingTimeMs:
        (result.processing_time_ms as number) || Date.now() - startTime,
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
