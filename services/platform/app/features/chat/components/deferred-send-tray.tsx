'use client';

import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useMutation, useQuery } from 'convex/react';
import { FileAudio, FileText, Image, Loader2, X } from 'lucide-react';
import { useMemo } from 'react';

import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { isAudioOrVideo, isImage } from '@/lib/shared/file-types';
import { formatFileSize } from '@/lib/utils/format/file';

import { useFileIndexingStatus } from '../hooks/use-file-indexing-status';
import { useFileTranscriptionStatus } from '../hooks/use-file-transcription-status';
import { VideoLinkChip } from './video-link-chip';

interface DeferredSendTrayProps {
  organizationId: string;
  threadId: string;
  /** Puts a cancelled row's text back into the (empty) composer. */
  onRestoreText: (text: string) => void;
}

/**
 * The parked sends above the composer — one row per message waiting for its
 * attachments to finish processing (send-then-wait). Each row shows every
 * medium it waits on with LIVE status (the 0.3 waiting-media detail): the
 * claimed video jobs keep their phase/progress — and, when one fails, its
 * error and Try again, because the row waits for exactly that user action —
 * and uploads show their indexing/transcription state. The row's ✕ abandons
 * the whole send (cancelling its claimed jobs) and puts the text back; a
 * `claimed` row is already starting and only shows its state. Renders
 * nothing while the queue is empty.
 */
export function DeferredSendTray({
  organizationId,
  threadId,
  onRestoreText,
}: DeferredSendTrayProps) {
  const { t } = useT('chat');
  const rows = useQuery(api.chat.deferred_sends.listDeferredSends, {
    organizationId,
    threadId,
  });
  // The claimed jobs left the composer's chip filter (they are bound), but
  // the thread query still carries them — join by id for live status.
  const threadJobs = useQuery(api.video_links.queries.listForThread, {
    organizationId,
    threadId,
  });
  const cancel = useMutation(api.chat.deferred_sends.cancelDeferredSend);
  const retryVideo = useMutation(api.video_links.mutations.retryVideoLink);

  // Every parked attachment across rows, for the two status hooks.
  const parkedAttachments = useMemo(
    () => (rows ?? []).flatMap((row) => row.attachments),
    [rows],
  );
  const { statusMap: indexingStatuses } = useFileIndexingStatus(
    parkedAttachments,
    organizationId,
  );
  const { statusMap: transcriptionStatuses } = useFileTranscriptionStatus(
    parkedAttachments,
    organizationId,
  );

  if (rows === undefined || rows.length === 0) return null;

  const jobById = new Map(
    (threadJobs ?? []).map((job) => [String(job.jobId), job]),
  );

  const attachmentStatus = (attachment: {
    fileId: string;
    fileType: string;
    fileSize: number;
  }): { label: string; failed: boolean } => {
    if (isAudioOrVideo(attachment.fileType)) {
      const info = transcriptionStatuses.get(attachment.fileId);
      if (info?.status === 'queued' || info?.status === 'running') {
        return {
          label: info.progress ?? t('transcription.transcribing'),
          failed: false,
        };
      }
      if (info?.status === 'failed' || info?.status === 'skipped') {
        return { label: t('transcription.couldNotTranscribe'), failed: true };
      }
      if (info?.status === 'completed') {
        return { label: t('transcription.transcribed'), failed: false };
      }
      return { label: formatFileSize(attachment.fileSize), failed: false };
    }
    if (isImage(attachment.fileType)) {
      return { label: formatFileSize(attachment.fileSize), failed: false };
    }
    const info = indexingStatuses.get(attachment.fileId);
    if (info?.status === 'queued' || info?.status === 'running') {
      let label = t('indexing');
      const raw = info.progress;
      if (raw !== undefined && raw.length > 0) {
        const match = /(\d+)\/(\d+)/.exec(raw);
        label = match
          ? `${Math.round((Number(match[1]) / Number(match[2])) * 100)}%`
          : raw;
      }
      return { label, failed: false };
    }
    if (info?.status === 'failed') {
      return { label: t('indexingFailed'), failed: true };
    }
    if (info?.status === 'unsupported') {
      return { label: t('indexingUnsupported'), failed: false };
    }
    return { label: formatFileSize(attachment.fileSize), failed: false };
  };

  return (
    <div className="mx-auto w-full max-w-3xl pb-2">
      {rows.map((row) => (
        <Stack
          key={row.deferredSendId}
          gap={1}
          className="border-border bg-muted/40 mt-1 rounded-lg border px-3 py-1.5"
        >
          <Row gap={2} align="center">
            <Loader2
              aria-hidden
              className="text-muted-foreground size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
            />
            <div className="min-w-0 flex-1">
              <Text variant="muted" className="block truncate text-xs">
                {row.status === 'claimed'
                  ? t('deferredSend.sending')
                  : t('deferredSend.waiting')}
              </Text>
              {row.userText.length > 0 && (
                <Text
                  variant="muted"
                  className="text-foreground block truncate text-xs"
                  title={row.userText}
                >
                  {row.userText}
                </Text>
              )}
            </div>
            {row.status === 'waiting' && (
              <button
                type="button"
                onClick={() => {
                  void cancel({
                    organizationId,
                    deferredSendId: row.deferredSendId,
                  }).then((cancelled) => {
                    if (cancelled) onRestoreText(row.userText);
                  });
                }}
                aria-label={t('deferredSend.cancel')}
                className="text-muted-foreground hover:text-foreground flex size-4 shrink-0 items-center justify-center"
              >
                <X aria-hidden className="size-3" />
              </button>
            )}
          </Row>
          {(row.videoJobIds.length > 0 || row.attachments.length > 0) && (
            <Row gap={2} wrap align="center" className="pl-5">
              {row.videoJobIds.map((jobId) => {
                const job = jobById.get(String(jobId));
                if (job === undefined) return null;
                return (
                  <VideoLinkChip
                    key={String(jobId)}
                    job={job}
                    onRetry={() => void retryVideo({ jobId })}
                  />
                );
              })}
              {row.attachments.map((attachment) => {
                const status = attachmentStatus(attachment);
                const FileIcon = isAudioOrVideo(attachment.fileType)
                  ? FileAudio
                  : isImage(attachment.fileType)
                    ? Image
                    : FileText;
                return (
                  <Row
                    key={attachment.fileId}
                    gap={2}
                    align="center"
                    className="border-border bg-background/60 h-9 max-w-[14rem] shrink-0 rounded-lg border px-2"
                  >
                    <FileIcon
                      aria-hidden
                      className="text-muted-foreground size-3.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <Text
                        variant="muted"
                        className="text-foreground block truncate text-xs font-medium"
                      >
                        {attachment.fileName}
                      </Text>
                      <Text
                        variant="muted"
                        className={`block truncate text-[10px] leading-tight ${
                          status.failed ? 'text-destructive' : ''
                        }`}
                      >
                        {status.label}
                      </Text>
                    </div>
                  </Row>
                );
              })}
            </Row>
          )}
        </Stack>
      ))}
    </div>
  );
}
