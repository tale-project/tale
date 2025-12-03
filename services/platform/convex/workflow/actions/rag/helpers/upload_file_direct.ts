import type { RagUploadResult } from './types';

export interface UploadFileDirectArgs {
  ragServiceUrl: string;
  fileUrl: string;
  filename: string;
  contentType: string;
  metadata?: Record<string, unknown>;
  timeoutMs?: number;
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
}: UploadFileDirectArgs): Promise<RagUploadResult> {
  const startTime = Date.now();

  // Step 1: Download file from Convex storage
  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) {
    throw new Error(
      `Failed to download file from storage: ${fileResponse.status}`,
    );
  }

  const fileBlob = await fileResponse.blob();

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
  if (metadata?.recordId) {
    formData.append('document_id', metadata.recordId as string);
  }

  // Step 3: Upload to RAG service
  const url = `${ragServiceUrl}/api/v1/documents/upload`;

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
    throw new Error(`RAG service error: ${response.status} ${errorText}`);
  }

  const result = (await response.json()) as Record<string, unknown>;

  const ragDocumentId = (result.document_id as string) || (result.id as string);
  const queued = (result.queued as boolean) ?? false;
  const jobId = (result.job_id as string) || undefined;

  return {
    success: (result.success as boolean | undefined) ?? true,
    recordId: (metadata?.recordId as string) || ragDocumentId || 'unknown',
    ragDocumentId,
    chunksCreated: (result.chunks_created as number) || 0,
    processingTimeMs: Date.now() - startTime,
    timestamp: Date.now(),
    queued,
    jobId,
  };
}

