'use client';

import { useQuery as useTanstackQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { FileAttachment } from '@/app/features/shared/files/types';
import { fileStatusesQuery } from '@/app/lib/backend/chat';
import type { BlobRef } from '@/convex/lib/storage/blob_ref';
import { isAudioOrVideo } from '@/lib/shared/file-types';

import { useChatQueryClient } from '../data/chat-backend';

type TranscriptionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface FileTranscriptionInfo {
  status?: TranscriptionStatus;
  error?: string;
  transcript?: string;
  durationSec?: number;
  progress?: string;
}

/**
 * Query transcription status for audio/video attachments staged in the
 * composer. Reactive Convex query — the watchdog cron ensures status
 * eventually leaves `running`.
 *
 * Exposes `isQueryLoading` so the send-gate can block pessimistically
 * during the brief window before metadata first resolves (prevents a
 * rapid click from slipping past a not-yet-known `running` state).
 *
 * Blocks send only while transcription is in flight (`queued`/`running`).
 * Failed and skipped are sendable — the turn injects a marker when no
 * transcript is available. Transcript RAG indexing is not part of this
 * restore, so `transcriptRagStatus` never gates the send.
 */
export function useFileTranscriptionStatus(
  attachments: readonly FileAttachment[],
  organizationId: string,
) {
  const audioFileIds = useMemo(
    () =>
      attachments
        .filter((a) => isAudioOrVideo(a.fileType))
        .map((a) => a.fileId),
    [attachments],
  );

  const statusesResult = useTanstackQuery(
    {
      ...fileStatusesQuery(organizationId ?? '', audioFileIds),
      enabled: Boolean(organizationId && audioFileIds.length > 0),
    },
    useChatQueryClient(),
  );
  const metadata = statusesResult.data;

  const isQueryLoading = audioFileIds.length > 0 && metadata === undefined;

  const statusMap = useMemo(() => {
    const map = new Map<BlobRef, FileTranscriptionInfo>();
    if (!metadata) return map;
    for (const m of metadata) {
      map.set(m.storageId, {
        status: m.transcriptionStatus,
        error: m.transcriptionError,
        transcript: m.transcript,
        durationSec: m.transcriptionDurationSec,
        progress: m.transcriptionProgress,
      });
    }
    return map;
  }, [metadata]);

  const isTranscribing = useMemo(() => {
    if (!metadata || audioFileIds.length === 0) return false;
    return metadata.some(
      (m) =>
        m.transcriptionStatus === 'queued' ||
        m.transcriptionStatus === 'running',
    );
  }, [metadata, audioFileIds.length]);

  return { statusMap, isTranscribing, isQueryLoading };
}
