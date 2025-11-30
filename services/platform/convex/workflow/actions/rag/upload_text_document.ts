import type { RagUploadResult } from './types';

/**
 * Upload text document to RAG service
 */
export async function uploadTextDocument(
  ragServiceUrl: string,
  content: string,
  metadata?: Record<string, unknown>,
  timeout = 30000,
): Promise<RagUploadResult> {
  const startTime = Date.now();
  const url = `${ragServiceUrl}/api/v1/documents`;

  const payload = {
    content,
    content_type: 'text',
    metadata: metadata || {},
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
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
    documentId: (metadata?.documentId as string) || ragDocumentId || 'unknown',
    ragDocumentId,
    chunksCreated: (result.chunks_created as number) || 0,
    processingTimeMs: Date.now() - startTime,
    timestamp: Date.now(),
    queued,
    jobId,
  };
}
