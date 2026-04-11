'use client';

import { useQuery } from 'convex/react';
import { useMemo } from 'react';

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import type { FileAttachment } from './use-convex-file-upload';

type RagStatus = 'queued' | 'running' | 'completed' | 'failed';

interface FileIndexingInfo {
  status?: RagStatus;
  error?: string;
  progress?: string;
}

/**
 * Query RAG indexing status for non-image file attachments.
 *
 * Uses a reactive Convex query so the UI updates automatically
 * as files transition through queued → running → completed/failed.
 */
export function useFileIndexingStatus(attachments: FileAttachment[]) {
  const fileIds = useMemo(
    () =>
      attachments
        .filter((a) => !a.fileType.startsWith('image/'))
        .map((a) => a.fileId),
    [attachments],
  );

  const metadata = useQuery(
    api.file_metadata.queries.getByStorageIds,
    fileIds.length > 0 ? { storageIds: fileIds } : 'skip',
  );

  const statusMap = useMemo(() => {
    const map = new Map<Id<'_storage'>, FileIndexingInfo>();
    if (!metadata) return map;
    for (const m of metadata) {
      map.set(m.storageId, {
        status: m.ragStatus,
        error: m.ragError,
        progress: m.ragProgress,
      });
    }
    return map;
  }, [metadata]);

  // Only block send for actively indexing files.
  // undefined (legacy records) and failed are not blocking.
  const isIndexing = useMemo(() => {
    if (!metadata || fileIds.length === 0) return false;
    return metadata.some(
      (m) => m.ragStatus === 'queued' || m.ragStatus === 'running',
    );
  }, [metadata, fileIds.length]);

  return { isIndexing, statusMap };
}
