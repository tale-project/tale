'use client';

import { useAction } from 'convex/react';
import { useQuery } from 'convex/react';
import { useEffect, useMemo, useRef } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import type { FileAttachment } from './use-convex-file-upload';

// 'unsupported' is a terminal, non-retryable status: no text extractor exists
// for the format at all, so the file will NEVER index — distinct from
// 'failed', which may be transient. Mirrors the documents page's `RagStatus`
// (`types/documents.ts`), minus the Hub-only `not_indexed`/`stale` states
// that don't apply to a freshly-uploaded chat attachment.
type RagStatus = 'queued' | 'running' | 'completed' | 'failed' | 'unsupported';

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
      } else if (current === 'unsupported') {
        // Unlike `failed`, `unsupported` is set synchronously at upload time
        // (see `saveFileMetadata`) — the client's first observation of the
        // file is already `unsupported`, never `queued`/`running`, so it can
        // never satisfy `wasPending`. Without this branch the file got zero
        // feedback: the composer's immediate "uploaded successfully" toast
        // already fired (non-indexable files skip the deferred-toast
        // suppression), silently implying the file is fully usable when the
        // assistant will never be able to search it. Non-destructive —
        // mirrors the Documents page's honest-but-calm treatment (a `slate`
        // informational badge, not the `failed` status's destructive one):
        // this is a heads-up, not an error (#2598 class).
        toast({
          title: t('indexingUnsupported'),
          description: t('indexingUnsupportedDescription', {
            filename: m.fileName,
          }),
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
