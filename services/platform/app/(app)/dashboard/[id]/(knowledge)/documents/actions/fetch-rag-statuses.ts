'use server';

import type { RagStatus } from '@/types/documents';

interface JobStatus {
  job_id: string;
  document_id: string | null;
  state: 'queued' | 'running' | 'completed' | 'failed';
  chunks_created: number;
  message: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

interface BatchJobsResponse {
  jobs: Record<string, JobStatus | null>;
}

export interface RagStatusInfo {
  status: RagStatus;
  /** Timestamp (in seconds) when the document was indexed (for completed status) */
  indexedAt?: number;
  /** Error message (for failed status) */
  error?: string;
}

export interface DocumentInfo {
  id: string;
  /** Timestamp (in milliseconds) when the document was last modified */
  lastModified?: number;
}

/**
 * Fetch RAG job statuses for multiple documents in a single batch call.
 * The job_id is the same as the document_id in the RAG service.
 *
 * @param documents - Array of document info objects with id and lastModified timestamp
 * @returns Record mapping document IDs to their RAG status info
 */
export async function fetchRagStatuses(
  documents: DocumentInfo[],
): Promise<Record<string, RagStatusInfo>> {
  if (documents.length === 0) {
    return {};
  }

  const documentIds = documents.map((doc) => doc.id);
  const lastModifiedMap = new Map(
    documents.map((doc) => [doc.id, doc.lastModified])
  );

  const ragUrl = process.env.RAG_URL || 'http://localhost:8001';
  const url = `${ragUrl}/api/v1/jobs/batch`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ job_ids: documentIds }),
      // Short timeout since this is for UI display
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error('[fetchRagStatuses] RAG service error:', response.status);
      // Return all as not_indexed if RAG service is unavailable
      return Object.fromEntries(
        documentIds.map((id) => [id, { status: 'not_indexed' as RagStatus }]),
      );
    }

    const data = (await response.json()) as BatchJobsResponse;

    // Convert RAG job states to our RagStatusInfo type
    const result: Record<string, RagStatusInfo> = {};
    for (const docId of documentIds) {
      const job = data.jobs[docId];
      if (!job) {
        result[docId] = { status: 'not_indexed' };
      } else if (job.state === 'completed') {
        const indexedAt = job.updated_at;
        const lastModified = lastModifiedMap.get(docId);

        // Check if document was updated after it was indexed
        // lastModified is in milliseconds, indexedAt is in seconds
        const isStale = lastModified && indexedAt && (lastModified / 1000) > indexedAt;

        result[docId] = {
          status: isStale ? 'stale' : 'completed',
          indexedAt,
        };
      } else {
        // Validate job state is a known RagStatus before using it
        const validStates = ['pending', 'queued', 'running', 'completed', 'failed', 'not_indexed', 'stale'] as const;
        const status = validStates.includes(job.state as typeof validStates[number])
          ? (job.state as RagStatus)
          : 'not_indexed';

        result[docId] = {
          status,
          // Include error message for failed jobs
          error: job.state === 'failed' ? (job.error || job.message || 'Unknown error') : undefined,
        };
      }
    }

    return result;
  } catch (error) {
    console.error('[fetchRagStatuses] Error fetching RAG statuses:', error);
    // Return all as not_indexed on error (graceful degradation)
    return Object.fromEntries(
      documentIds.map((id) => [id, { status: 'not_indexed' as RagStatus }]),
    );
  }
}

