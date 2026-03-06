import type { RagUploadResult } from './types';

export interface UploadFileArgs {
  ragServiceUrl: string;
  file: Blob;
  filename: string;
  contentType: string;
  documentId: string;
  metadata?: Record<string, unknown>;
  timeoutMs?: number;
}

interface RagApiUploadResponse {
  document_id?: string;
  id?: string;
  success?: boolean;
  chunks_created?: number;
}

/**
 * Upload a file to the RAG service via multipart/form-data.
 */
export async function uploadFile({
  ragServiceUrl,
  file,
  filename,
  contentType,
  documentId,
  metadata,
  timeoutMs = 30000,
}: UploadFileArgs): Promise<RagUploadResult> {
  const startTime = Date.now();

  const formData = new FormData();
  formData.append('file', file, filename);
  formData.append('document_id', documentId);
  formData.append(
    'metadata',
    JSON.stringify({ ...metadata, content_type: contentType }),
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(`${ragServiceUrl}/api/v1/documents/upload`, {
    method: 'POST',
    body: formData,
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `RAG service error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
    );
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- typed response
  const result = (await response.json()) as RagApiUploadResponse;
  const ragDocumentId = result.document_id || result.id;

  return {
    success: result.success ?? true,
    recordId: documentId,
    ragDocumentId,
    chunksCreated: result.chunks_created || 0,
    processingTimeMs: Date.now() - startTime,
    timestamp: Date.now(),
  };
}
