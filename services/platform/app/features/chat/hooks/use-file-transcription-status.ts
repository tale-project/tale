'use client';

import { useQuery } from 'convex/react';
import { useMemo } from 'react';

import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import { isAudioOrVideo } from '../../../../lib/shared/file-types';
import type { FileAttachment } from './use-convex-file-upload';

type TranscriptionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

type RagStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface FileTranscriptionInfo {
  status?: TranscriptionStatus;
  error?: string;
  transcript?: string;
  durationSec?: number;
  progress?: string;
  startedAt?: number;
  /** RAG indexing status for the transcript text. `document_retrieve`
   * requires this to be `completed` before the agent can read the content. */
  ragStatus?: RagStatus;
  ragError?: string;
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
    () =>
      attachments
        .filter((a) => isAudioOrVideo(a.fileType))
        .map((a) => a.fileId),
    [attachments],
  );

  const organizationId = useOrganizationId();
  const metadata = useQuery(
    api.file_metadata.queries.getByStorageIds,
    audioFileIds.length > 0 && organizationId
      ? { storageIds: audioFileIds, organizationId }
      : 'skip',
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
        ragStatus: m.transcriptRagStatus,
        ragError: m.transcriptRagError,
        startedAt: m._creationTime,
      });
    }
    return map;
  }, [metadata]);

  // Block send while any audio is still transcribing OR still indexing into
  // RAG. Both must reach a terminal state (completed/failed/skipped) before
  // the LLM can reliably call `document_retrieve` to read the transcript.
  const isTranscribing = useMemo(() => {
    if (!metadata || audioFileIds.length === 0) return false;
    return metadata.some(
      (m) =>
        m.transcriptionStatus === 'queued' ||
        m.transcriptionStatus === 'running' ||
        m.transcriptRagStatus === 'queued' ||
        m.transcriptRagStatus === 'running',
    );
  }, [metadata, audioFileIds.length]);

  // True when any audio attachment's transcription terminally `failed`. The
  // send-gate uses this to force the user to retry or remove before sending,
  // mirroring `hasFailedVideoJobs`. `skipped` is intentionally excluded — it
  // is a deliberate user action (remove → skipTranscription), so re-offering
  // a retry there would fight the user's own intent.
  const hasFailedAudioJobs = useMemo(() => {
    if (!metadata) return false;
    return metadata.some((m) => m.transcriptionStatus === 'failed');
  }, [metadata]);

  return { statusMap, isTranscribing, isQueryLoading, hasFailedAudioJobs };
}
