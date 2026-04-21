'use client';

import { useQuery } from 'convex/react';
import { useMemo } from 'react';

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import { isAudio } from '../../../../lib/shared/file-types';
import type { FileAttachment } from './use-convex-file-upload';

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
  startedAt?: number;
}

/**
 * Query transcription status for audio attachments.
 *
 * Reactive Convex query; no client polling needed — the watchdog cron
 * ensures status eventually transitions out of `running`.
 *
 * Exposes `isQueryLoading` so the chat send-gate can block pessimistically
 * during the brief window before metadata first resolves (prevents a rapid
 * click from slipping past a not-yet-known `running` state).
 */
export function useFileTranscriptionStatus(attachments: FileAttachment[]) {
  const audioFileIds = useMemo(
    () => attachments.filter((a) => isAudio(a.fileType)).map((a) => a.fileId),
    [attachments],
  );

  const metadata = useQuery(
    api.file_metadata.queries.getByStorageIds,
    audioFileIds.length > 0 ? { storageIds: audioFileIds } : 'skip',
  );

  const isQueryLoading = audioFileIds.length > 0 && metadata === undefined;

  const statusMap = useMemo(() => {
    const map = new Map<Id<'_storage'>, FileTranscriptionInfo>();
    if (!metadata) return map;
    for (const m of metadata) {
      map.set(m.storageId, {
        status: m.transcriptionStatus,
        error: m.transcriptionError,
        transcript: m.transcript,
        durationSec: m.transcriptionDurationSec,
        progress: m.transcriptionProgress,
        startedAt: m._creationTime,
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
