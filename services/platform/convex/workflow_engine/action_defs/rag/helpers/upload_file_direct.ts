import type { RagUploadResult } from './types';

export interface UploadFileDirectArgs {
  ragServiceUrl: string;
  fileUrl: string;
  filename: string;
  contentType: string;
  metadata?: Record<string, unknown>;
  timeoutMs?: number;
  /** User ID for multi-tenant isolation */
  userId?: string;
  /** Team IDs for team-level isolation (will be converted to dataset internally) */
  teamIds?: string[];
}

/**
 * RAG API upload response structure
 */
interface RagApiUploadResponse {
  document_id?: string;
  id?: string;
  queued?: boolean;
  job_id?: string;
  success?: boolean;
  chunks_created?: number;
}

/**
 * Upload file document to RAG service by downloading from URL and uploading directly
 *
 * This approach downloads the file from Convex storage and uploads it directly
 * to the RAG service using multipart/form-data, which is more reliable than
 * having the RAG service fetch from a URL.
 */
export async function uploadFileDirect({
  ragServiceUrl,
  fileUrl,
  filename,
  contentType,
  metadata,
  timeoutMs = 30000,
  userId,
  teamIds,
}: UploadFileDirectArgs): Promise<RagUploadResult> {
  const startTime = Date.now();

  // Step 1: Download file from Convex storage
  console.log('[uploadFileDirect] Downloading file from storage:', {
    fileUrl: fileUrl.slice(0, 100) + '...',
    filename,
  });

  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) {
    throw new Error(
      `Failed to download file from storage: ${fileResponse.status}`,
    );
  }

  const fileBlob = await fileResponse.blob();
  console.log('[uploadFileDirect] File downloaded:', {
    size: fileBlob.size,
    type: fileBlob.type,
  });

  // Step 2: Prepare multipart/form-data upload
  const formData = new FormData();
  formData.append('file', fileBlob, filename);

  // Add metadata as JSON string if provided
  // Include contentType in metadata to match what RAG service expects
  const enrichedMetadata = {
    ...metadata,
    content_type: contentType,
  };

  if (enrichedMetadata) {
    formData.append('metadata', JSON.stringify(enrichedMetadata));
  }

  // Add document_id if provided in metadata (mapped from recordId)
  const recordIdFromMetadata =
    typeof metadata?.recordId === 'string' ? metadata.recordId : undefined;
  if (recordIdFromMetadata) {
    formData.append('document_id', recordIdFromMetadata);
  }

  // Add multi-tenant parameters if provided
  if (userId) {
    formData.append('user_id', userId);
  }
  if (teamIds && teamIds.length > 0) {
    formData.append('team_ids', teamIds.join(','));
  }

  // Step 3: Upload to RAG service
  const url = `${ragServiceUrl}/api/v1/documents/upload`;

  console.log('[uploadFileDirect] Starting RAG upload:', {
    url,
    filename,
    contentType,
    fileSize: fileBlob.size,
    timeoutMs,
    hasMetadata: !!metadata,
    hasDocumentId: !!recordIdFromMetadata,
    hasUserId: !!userId,
    teamIds,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[uploadFileDirect] RAG service error:', {
      status: response.status,
      statusText: response.statusText,
      url,
      errorText: errorText || '(empty response)',
      headers: Object.fromEntries(
        response.headers as unknown as Iterable<[string, string]>,
      ),
    });
    throw new Error(
      `RAG service error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
    );
  }

  const result = (await response.json()) as RagApiUploadResponse;

  const ragDocumentId = result.document_id || result.id;
  const queued = result.queued ?? false;
  const jobId = result.job_id;

  return {
    success: result.success ?? true,
    recordId: recordIdFromMetadata || ragDocumentId || 'unknown',
    ragDocumentId,
    chunksCreated: result.chunks_created || 0,
    processingTimeMs: Date.now() - startTime,
    timestamp: Date.now(),
    queued,
    jobId,
  };
}
