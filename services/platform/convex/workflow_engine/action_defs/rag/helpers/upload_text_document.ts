import type { RagUploadResult } from './types';

import {
  getString,
  getNumber,
  getBoolean,
  isRecord,
} from '../../../../../lib/utils/type-guards';

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

  const rawResult: unknown = await response.json();
  const result = isRecord(rawResult) ? rawResult : {};

  const ragDocumentId =
    getString(result, 'document_id') || getString(result, 'id');
  const queued = getBoolean(result, 'queued') ?? false;
  const jobId = getString(result, 'job_id') || undefined;

  return {
    success: getBoolean(result, 'success') ?? true,
    recordId:
      recordId ||
      (metadata ? getString(metadata, 'recordId') : undefined) ||
      ragDocumentId ||
      'unknown',
    ragDocumentId,
    chunksCreated: getNumber(result, 'chunks_created') || 0,
    processingTimeMs: Date.now() - startTime,
    timestamp: Date.now(),
    queued,
    jobId,
  };
}
