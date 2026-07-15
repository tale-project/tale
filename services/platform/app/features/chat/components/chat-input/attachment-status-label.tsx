'use client';

import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Loader } from 'lucide-react';

import type { BlobRef } from '@/convex/lib/storage/blob_ref';
import { useT } from '@/lib/i18n/client';
import { isAudioOrVideo } from '@/lib/shared/file-types';
import { formatFileSize } from '@/lib/utils/format/file';

import type { FileAttachment } from '../../hooks/use-convex-file-upload';

export interface TranscriptionStatusInfo {
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  error?: string;
  progress?: string;
  transcript?: string;
  durationSec?: number;
  ragStatus?: 'queued' | 'running' | 'completed' | 'failed';
  ragError?: string;
}

export interface IndexingStatusInfo {
  status?: string;
  error?: string;
  progress?: string;
}

interface AttachmentStatusLabelProps {
  attachment: FileAttachment;
  transcriptionStatuses?: Map<BlobRef, TranscriptionStatusInfo>;
  indexingStatuses?: Map<BlobRef, IndexingStatusInfo>;
}

/**
 * The status line under a non-image attachment chip. Audio/video attachments
 * show the two-phase transcription → indexing → indexed status; everything
 * else shows the RAG-indexing status (or the file size when idle). Fully
 * prop-driven so it can re-render independently of the composer shell.
 */
export function AttachmentStatusLabel({
  attachment,
  transcriptionStatuses,
  indexingStatuses,
}: AttachmentStatusLabelProps) {
  const { t: tChat } = useT('chat');

  // Audio + video attachments: show two-phase status
  // (transcribing → indexing → indexed) instead of the
  // RAG-indexing status we show for other uploads.
  if (isAudioOrVideo(attachment.fileType)) {
    const info = transcriptionStatuses?.get(attachment.fileId);
    const status = info?.status;
    const ragStatus = info?.ragStatus;
    if (status === 'queued' || status === 'running') {
      return (
        <HStack gap={1} align="center">
          <Loader className="text-muted-foreground/50 size-3 animate-spin" />
          <Text
            as="span"
            variant="caption"
            className="text-muted-foreground/50"
          >
            {info?.progress || tChat('transcription.transcribing')}
          </Text>
        </HStack>
      );
    }
    if (
      status === 'completed' &&
      (ragStatus === 'queued' || ragStatus === 'running')
    ) {
      return (
        <HStack gap={1} align="center">
          <Loader className="text-muted-foreground/50 size-3 animate-spin" />
          <Text
            as="span"
            variant="caption"
            className="text-muted-foreground/50"
          >
            {tChat('transcription.indexing')}
          </Text>
        </HStack>
      );
    }
    if (status === 'completed') {
      // `ragStatus` completed → "Indexed" (agent can
      // retrieve). `ragStatus === 'failed'` → show
      // "Transcribed" but warn the agent retrieval
      // will be unavailable.
      const label =
        ragStatus === 'completed'
          ? tChat('transcription.indexed')
          : ragStatus === 'failed'
            ? tChat('transcription.indexingFailed')
            : tChat('transcription.transcribed');
      return (
        <Text
          as="span"
          variant="caption"
          className={
            ragStatus === 'failed'
              ? 'text-destructive'
              : 'text-muted-foreground/70'
          }
        >
          {label}
        </Text>
      );
    }
    if (status === 'failed' || status === 'skipped') {
      return (
        <Text as="span" variant="caption" className="text-destructive">
          {tChat('transcription.couldNotTranscribe')}
        </Text>
      );
    }
    return (
      <Text as="div" variant="caption" className="text-muted-foreground/50">
        {formatFileSize(attachment.fileSize)}
      </Text>
    );
  }

  const info = indexingStatuses?.get(attachment.fileId);
  const ragStatus = info?.status;
  if (ragStatus === 'queued' || ragStatus === 'running') {
    const raw = info?.progress;
    // Convert "extracting 42/108" → "39%"
    let progressLabel = tChat('indexing');
    if (raw) {
      const match = /(\d+)\/(\d+)/.exec(raw);
      if (match) {
        const pct = Math.round((Number(match[1]) / Number(match[2])) * 100);
        progressLabel = `${pct}%`;
      } else {
        progressLabel = raw;
      }
    }
    return (
      <HStack gap={1} align="center">
        <Loader className="text-muted-foreground/50 size-3 animate-spin" />
        <Text as="span" variant="caption" className="text-muted-foreground/50">
          {progressLabel}
        </Text>
      </HStack>
    );
  }
  if (ragStatus === 'failed') {
    // Surface the stored failure reason (ragError) so
    // the user can tell a transient outage from a
    // rejected file without digging into logs.
    return (
      <Text
        as="span"
        variant="caption"
        className="text-destructive"
        title={info?.error}
      >
        {tChat('indexingFailed')}
      </Text>
    );
  }
  return (
    <Text as="div" variant="caption" className="text-muted-foreground/50">
      {formatFileSize(attachment.fileSize)}
    </Text>
  );
}
