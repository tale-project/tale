'use client';

import { useQuery as useTanstackQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import type { FileAttachment } from '@/app/features/shared/files/types';
import { toast } from '@/app/hooks/use-toast';
import { fileStatusesQuery } from '@/app/lib/backend/chat';
import type { BlobRef } from '@/convex/lib/storage/blob_ref';
import { useT } from '@/lib/i18n/client';
import {
  isAudioOrVideo,
  isImage,
  isRagIndexableFile,
} from '@/lib/shared/file-types';

import { useChatQueryClient } from '../data/chat-backend';

// 'unsupported' is a terminal, non-retryable status: the RAG service has no
// text extractor for the format, so the file will NEVER index — distinct
// from 'failed', which may be transient.
type RagStatus = 'queued' | 'running' | 'completed' | 'failed' | 'unsupported';

export interface FileIndexingInfo {
  status?: RagStatus;
  error?: string;
  progress?: string;
}

/**
 * RAG-indexing status for document / text attachments staged in the
 * composer — the set the upload hook defers its success toast for
 * (`willIndex` in `use-convex-file-upload`). Reactive Convex query; the
 * server-side poll chain patches the row as ingestion progresses and the
 * watchdog guarantees a terminal state, so no client polling is needed.
 *
 * Owns the deferred upload feedback: when a tracked file leaves
 * `queued`/`running` we fire the success toast on `completed` and the
 * "Index failed" toast on `failed`. Keying on the TRANSITION (not the
 * absolute status) keeps a remount that observes an already-finished file
 * silent, so the toast fires exactly once per upload.
 *
 * `isIndexing` gates the send the same way transcription does: a document
 * the model would be told to retrieve must be retrievable by the time the
 * turn starts.
 */
export function useFileIndexingStatus(
  attachments: readonly FileAttachment[],
  organizationId: string,
) {
  const { t } = useT('chat');
  const fileIds = useMemo(
    () =>
      attachments
        .filter(
          (a) =>
            !isImage(a.fileType) &&
            !isAudioOrVideo(a.fileType) &&
            isRagIndexableFile(a.fileName, a.fileType),
        )
        .map((a) => a.fileId),
    [attachments],
  );

  const statusesResult = useTanstackQuery(
    {
      ...fileStatusesQuery(organizationId ?? '', fileIds),
      enabled: Boolean(organizationId && fileIds.length > 0),
    },
    useChatQueryClient(),
  );
  const metadata = statusesResult.data;

  const isQueryLoading = fileIds.length > 0 && metadata === undefined;

  const statusMap = useMemo(() => {
    const map = new Map<BlobRef, FileIndexingInfo>();
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

  const prevStatusRef = useRef(new Map<BlobRef, RagStatus>());
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
          description: t('indexingFailedDescription', {
            filename: m.fileName,
          }),
          variant: 'destructive',
        });
      } else if (current === 'unsupported') {
        // Set by the corpus reconciliation, possibly as the FIRST status the
        // client observes (never `queued`/`running` before it), so it can't
        // satisfy `wasPending`. A heads-up, not an error: the file is still
        // usable as an attachment marker, the assistant just can't read it.
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

  return { statusMap, isIndexing, isQueryLoading };
}
