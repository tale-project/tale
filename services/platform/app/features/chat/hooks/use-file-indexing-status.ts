'use client';

import { useAction } from 'convex/react';
import { useQuery } from 'convex/react';
import { useEffect, useMemo, useRef } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import type { FileAttachment } from './use-convex-file-upload';

type RagStatus = 'queued' | 'running' | 'completed' | 'failed';

interface FileIndexingInfo {
  status?: RagStatus;
  error?: string;
  progress?: string;
}

const POLL_INTERVAL_MS = 3_000;

/**
 * Query RAG indexing status for non-image file attachments.
 *
 * - Reactive Convex query for instant UI updates when status changes.
 * - Client-side polling: calls checkFileRagStatuses action every 3s
 *   while any file is in queued/running state. Polling stops automatically
 *   when the user leaves the page or all files finish indexing.
 */
export function useFileIndexingStatus(
  attachments: FileAttachment[],
  organizationId: string,
) {
  const { t } = useT('chat');
  const fileIds = useMemo(
    () =>
      attachments
        .filter((a) => !a.fileType.startsWith('image/'))
        .map((a) => a.fileId),
    [attachments],
  );

  const metadata = useQuery(
    api.file_metadata.queries.getByStorageIds,
    organizationId && fileIds.length > 0
      ? { organizationId, storageIds: fileIds }
      : 'skip',
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

  // Deferred upload feedback (#1457): the composer suppresses the
  // "uploaded successfully" toast for files that get RAG-indexed because
  // indexing runs asynchronously and can still fail. We own the terminal
  // signal here — when a tracked file transitions out of a pending state
  // (queued/running) into `completed` we fire the success toast, and into
  // `failed` we fire the "Index failed" error toast. Keying on the
  // transition (not the absolute status) means a remount that observes an
  // already-finished file stays silent, and the success toast fires exactly
  // once per upload.
  const prevStatusRef = useRef(new Map<Id<'_storage'>, RagStatus>());

  useEffect(() => {
    if (!metadata) return;
    const prev = prevStatusRef.current;
    for (const m of metadata) {
      const before = prev.get(m.storageId);
      const current = m.ragStatus;
      if (before === current) continue;
      const wasPending = before === 'queued' || before === 'running';
      if (wasPending && current === 'completed') {
        toast({
          title: t('fileUploaded'),
          description: t('uploadedSuccessfully', { filename: m.fileName }),
        });
      } else if (wasPending && current === 'failed') {
        toast({
          title: t('indexingFailed'),
          description: t('indexingFailedDescription', { filename: m.fileName }),
          variant: 'destructive',
        });
      }
      if (current === undefined) {
        prev.delete(m.storageId);
      } else {
        prev.set(m.storageId, current);
      }
    }
  }, [metadata, t]);

  const isIndexing = useMemo(() => {
    if (!metadata || fileIds.length === 0) return false;
    return metadata.some(
      (m) => m.ragStatus === 'queued' || m.ragStatus === 'running',
    );
  }, [metadata, fileIds.length]);

  // IDs of files that still need polling
  const pendingIds = useMemo(() => {
    if (!metadata) return [];
    return metadata
      .filter((m) => m.ragStatus === 'queued' || m.ragStatus === 'running')
      .map((m) => m.storageId);
  }, [metadata]);

  // Client-side polling: call the action periodically while files are pending
  const checkStatuses = useAction(
    api.file_metadata.actions.checkFileRagStatuses,
  );
  const pollingRef = useRef(false);

  useEffect(() => {
    if (pendingIds.length === 0) return undefined;

    pollingRef.current = true;

    // Trigger immediately, then poll on interval
    checkStatuses({ storageIds: pendingIds }).catch(() => {});

    const timer = setInterval(() => {
      if (!pollingRef.current) return;
      checkStatuses({ storageIds: pendingIds }).catch(() => {});
    }, POLL_INTERVAL_MS);

    return () => {
      pollingRef.current = false;
      clearInterval(timer);
    };
  }, [pendingIds, checkStatuses]);

  return { isIndexing, statusMap };
}
