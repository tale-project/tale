import type { RagUploadResult } from './types';

export interface UploadTextDocumentArgs {
  ragServiceUrl: string;
  content: string;
  metadata?: Record<string, unknown>;
  /** Optional logical record identifier; sent as `document_id` to the RAG endpoint. */
  recordId?: string;
  timeoutMs?: number;
  /** User ID for multi-tenant isolation */
  userId?: string;
  /** Team IDs for team-level isolation (will be converted to dataset internally) */
  teamIds?: string[];
}

/**
 * Upload text document to RAG service
 */
export async function uploadTextDocument({
  ragServiceUrl,
  content,
  metadata,
  recordId,
  timeoutMs = 30000,
  userId,
  teamIds,
}: UploadTextDocumentArgs): Promise<RagUploadResult> {
  const startTime = Date.now();
  const url = `${ragServiceUrl}/api/v1/documents`;

  const payload: Record<string, unknown> = {
    content,
    content_type: 'text',
    metadata: metadata || {},
  };

  // If a logical recordId is provided, also use it as the endpoint document_id
  if (recordId) {
    payload.document_id = recordId;
  }

  // Add multi-tenant parameters if provided
  if (userId) {
    payload.user_id = userId;
  }
  if (teamIds && teamIds.length > 0) {
    payload.team_ids = teamIds;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
    recordId:
      recordId || (metadata?.recordId as string) || ragDocumentId || 'unknown',
    ragDocumentId,
    chunksCreated: (result.chunks_created as number) || 0,
    processingTimeMs: Date.now() - startTime,
    timestamp: Date.now(),
    queued,
    jobId,
  };
}
