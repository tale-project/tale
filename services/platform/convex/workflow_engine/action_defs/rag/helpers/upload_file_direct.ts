import type { RagUploadResult } from './types';

export interface UploadFileArgs {
  ragServiceUrl: string;
  file: Blob;
  filename: string;
  contentType: string;
  fileId: string;
  metadata?: Record<string, unknown>;
  timeoutMs?: number;
  sync?: boolean;
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
const SYNC_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export async function uploadFile({
  ragServiceUrl,
  file,
  filename,
  contentType,
  fileId,
  metadata,
  timeoutMs,
  sync = false,
}: UploadFileArgs): Promise<RagUploadResult> {
  const effectiveTimeout =
    timeoutMs ?? (sync ? SYNC_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const startTime = Date.now();

  const formData = new FormData();
  formData.append('file', file, filename);
  formData.append('document_id', fileId);
  formData.append(
    'metadata',
    JSON.stringify({ ...metadata, content_type: contentType }),
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

  const uploadUrl = sync
    ? `${ragServiceUrl}/api/v1/documents/upload?sync=true`
    : `${ragServiceUrl}/api/v1/documents/upload`;

  const response = await fetch(uploadUrl, {
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
    fileId,
    ragDocumentId,
    chunksCreated: result.chunks_created || 0,
    processingTimeMs: Date.now() - startTime,
    timestamp: Date.now(),
  };
}
