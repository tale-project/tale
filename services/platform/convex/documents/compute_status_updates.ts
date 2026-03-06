import type { Id } from '../_generated/dataModel';

type RagInfoStatus = 'queued' | 'running' | 'completed' | 'failed';

interface DocumentForSync {
  _id: Id<'documents'>;
  _creationTime: number;
  ragInfo: {
    status: RagInfoStatus;
    indexedAt?: number;
    error?: string;
  };
}

interface RagStatusInfo {
  status: string;
  error?: string | null;
}

interface StatusUpdate {
  documentId: Id<'documents'>;
  ragInfo: {
    status: RagInfoStatus;
    indexedAt?: number;
    error?: string;
  };
}

const PROCESSING_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export function computeStatusUpdates(
  documents: DocumentForSync[],
  ragStatuses: Record<string, RagStatusInfo | null>,
  now: number,
): StatusUpdate[] {
  const updates: StatusUpdate[] = [];

  for (const doc of documents) {
    const ragStatus = ragStatuses[doc._id];
    const convexStatus = doc.ragInfo.status;

    if (ragStatus === null || ragStatus === undefined) {
      // Not found in RAG
      if (convexStatus === 'completed') {
        updates.push({
          documentId: doc._id,
          ragInfo: {
            status: 'failed',
            error: 'Document no longer exists in RAG service',
          },
        });
      }
      // Skip queued/running — defer to polling (in-flight docs)
      continue;
    }

    const ragState = ragStatus.status;

    if (
      ragState === 'completed' &&
      (convexStatus === 'queued' || convexStatus === 'running')
    ) {
      updates.push({
        documentId: doc._id,
        ragInfo: {
          status: 'completed',
          indexedAt: now,
        },
      });
    } else if (ragState === 'processing' && convexStatus === 'queued') {
      updates.push({
        documentId: doc._id,
        ragInfo: {
          status: 'running',
        },
      });
    } else if (
      ragState === 'processing' &&
      convexStatus === 'running' &&
      now - doc._creationTime > PROCESSING_TIMEOUT_MS
    ) {
      updates.push({
        documentId: doc._id,
        ragInfo: {
          status: 'failed',
          error: 'Processing timed out',
        },
      });
    } else if (
      ragState === 'failed' &&
      (convexStatus === 'queued' || convexStatus === 'running')
    ) {
      updates.push({
        documentId: doc._id,
        ragInfo: {
          status: 'failed',
          error: ragStatus.error || 'Unknown error',
        },
      });
    }
  }

  return updates;
}
