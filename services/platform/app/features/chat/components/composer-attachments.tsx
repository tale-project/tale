'use client';

/**
 * The composer's staged attachments — the strip between the quote chip and
 * the text field.
 *
 * An image renders as a small thumbnail (click = zoomable preview, ✕ =
 * remove); audio/video render as a named chip with transcription status
 * (and a Retry when transcription failed); documents and text files render
 * as a named chip with RAG-indexing status; an upload still in flight
 * renders as a spinner chip whose ✕ aborts it. The strip disappears
 * entirely when nothing is staged, so the composer's resting chrome is
 * unchanged.
 *
 * When the picked model cannot see images (no `vision` catalog tag) the
 * strip says so up front — the alternative is a model politely explaining
 * it is blind, one full turn too late. Audio never needs that warning:
 * it rides the turn as transcribed text.
 */

import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { FileAudio, FileText, Loader2, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';

import type { FileIndexingInfo } from '@/app/features/chat/hooks/use-file-indexing-status';
import type { FileTranscriptionInfo } from '@/app/features/chat/hooks/use-file-transcription-status';
import type { FileAttachment } from '@/app/features/shared/files/types';
import { useFileUrl } from '@/app/features/shared/files/use-file-url';
import { ImagePreviewDialog } from '@/app/features/shared/markdown/image-preview-dialog';
import type { BlobRef } from '@/convex/lib/storage/blob_ref';
import { useT } from '@/lib/i18n/client';
import { isAudioOrVideo, isImage } from '@/lib/shared/file-types';
import { formatFileSize } from '@/lib/utils/format/file';

interface ComposerAttachmentsProps {
  attachments: readonly FileAttachment[];
  /** Per-upload ids still in flight — each renders a spinner chip. */
  uploadingFiles: readonly string[];
  onRemove: (fileId: string) => void;
  onCancelUpload: (fileId: string) => void;
  /** Why staged images would go unseen (pinned model is blind, or no model
   * in the catalog can see) — rendered as a warning while any are staged. */
  visionWarning?: string;
  /** Live transcription status for staged audio/video attachments. */
  transcriptionStatuses?: ReadonlyMap<BlobRef, FileTranscriptionInfo>;
  onRetryTranscription?: (fileId: string) => void;
  /** Live RAG-indexing status for staged document / text attachments. */
  indexingStatuses?: ReadonlyMap<BlobRef, FileIndexingInfo>;
}

/** One staged image. The object-URL preview serves the common case; a
 * restored attachment (send refused after its preview was revoked) falls
 * back to the server-resolved URL. */
function StagedImage({
  attachment,
  onOpen,
  onRemove,
}: {
  attachment: FileAttachment;
  onOpen: (url: string) => void;
  onRemove: () => void;
}) {
  const { t } = useT('chat');
  const { data: serverUrl } = useFileUrl(
    attachment.fileId,
    attachment.previewUrl !== undefined,
  );
  const url = attachment.previewUrl ?? serverUrl ?? undefined;

  return (
    <div className="ring-border group relative size-9 shrink-0 overflow-hidden rounded-lg ring-1">
      <button
        type="button"
        onClick={() => url !== undefined && onOpen(url)}
        aria-label={t('viewImage')}
        className="size-full cursor-pointer border-none bg-transparent p-0"
      >
        {url !== undefined && (
          <img
            src={url}
            alt={attachment.fileName}
            className="size-full object-cover"
          />
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('removeAttachment')}
        // Always reachable: opacity-only hiding keeps it clickable and
        // focus-visible for keyboard users; hover reveal is cosmetic.
        className="bg-background/90 text-foreground absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X aria-hidden className="size-3" />
      </button>
    </div>
  );
}

function StagedMedia({
  attachment,
  info,
  onRemove,
  onRetry,
}: {
  attachment: FileAttachment;
  info: FileTranscriptionInfo | undefined;
  onRemove: () => void;
  onRetry?: () => void;
}) {
  const { t } = useT('chat');
  const status = info?.status;
  const inFlight = status === 'queued' || status === 'running';
  const failed = status === 'failed';
  const completed = status === 'completed';

  let statusLabel: string;
  if (inFlight) {
    statusLabel = info?.progress || t('transcription.transcribing');
  } else if (completed) {
    statusLabel = t('transcription.transcribed');
  } else if (failed || status === 'skipped') {
    statusLabel = t('transcription.couldNotTranscribe');
  } else {
    statusLabel = formatFileSize(attachment.fileSize);
  }

  return (
    <Row
      gap={2}
      align="center"
      className="border-border bg-muted/40 h-9 max-w-[14rem] shrink-0 rounded-lg border px-2"
    >
      {inFlight ? (
        <Loader2
          aria-hidden
          className="text-muted-foreground size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
        />
      ) : (
        <FileAudio
          aria-hidden
          className="text-muted-foreground size-3.5 shrink-0"
        />
      )}
      <div className="min-w-0 flex-1">
        <Text
          variant="muted"
          className="text-foreground block truncate text-xs font-medium"
        >
          {attachment.fileName}
        </Text>
        <Text
          variant="muted"
          className="block truncate text-[10px] leading-tight"
        >
          {statusLabel}
        </Text>
      </div>
      {failed && onRetry !== undefined && (
        <button
          type="button"
          onClick={onRetry}
          className="text-muted-foreground hover:text-foreground shrink-0 text-[10px] underline"
        >
          {t('transcription.retry')}
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('removeAttachment')}
        className="text-muted-foreground hover:text-foreground flex size-4 shrink-0 items-center justify-center"
      >
        <X aria-hidden className="size-3" />
      </button>
    </Row>
  );
}

/** One staged document / text file: a named chip whose status line tracks
 * RAG indexing (queued/running → spinner, failed → destructive label with
 * the stored reason on hover, unsupported → calm heads-up, idle → size).
 * Mirrors 0.3's attachment-status-label semantics. */
function StagedDocument({
  attachment,
  info,
  onRemove,
}: {
  attachment: FileAttachment;
  info: FileIndexingInfo | undefined;
  onRemove: () => void;
}) {
  const { t } = useT('chat');
  const status = info?.status;
  const inFlight = status === 'queued' || status === 'running';

  let statusLabel: string;
  if (inFlight) {
    // The service reports raw step counts ("extracting 42/108") — show a
    // percentage; any other progress string passes through as-is.
    statusLabel = t('indexing');
    const raw = info?.progress;
    if (raw !== undefined && raw.length > 0) {
      const match = /(\d+)\/(\d+)/.exec(raw);
      statusLabel = match
        ? `${Math.round((Number(match[1]) / Number(match[2])) * 100)}%`
        : raw;
    }
  } else if (status === 'failed') {
    statusLabel = t('indexingFailed');
  } else if (status === 'unsupported') {
    statusLabel = t('indexingUnsupported');
  } else {
    statusLabel = formatFileSize(attachment.fileSize);
  }

  return (
    <Row
      gap={2}
      align="center"
      className="border-border bg-muted/40 h-9 max-w-[14rem] shrink-0 rounded-lg border px-2"
    >
      {inFlight ? (
        <Loader2
          aria-hidden
          className="text-muted-foreground size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
        />
      ) : (
        <FileText
          aria-hidden
          className="text-muted-foreground size-3.5 shrink-0"
        />
      )}
      <div className="min-w-0 flex-1">
        <Text
          variant="muted"
          className="text-foreground block truncate text-xs font-medium"
        >
          {attachment.fileName}
        </Text>
        <Text
          variant="muted"
          {...(status === 'failed' && info?.error !== undefined
            ? { title: info.error }
            : {})}
          className={`block truncate text-[10px] leading-tight ${
            status === 'failed' ? 'text-destructive' : ''
          }`}
        >
          {statusLabel}
        </Text>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('removeAttachment')}
        className="text-muted-foreground hover:text-foreground flex size-4 shrink-0 items-center justify-center"
      >
        <X aria-hidden className="size-3" />
      </button>
    </Row>
  );
}

export function ComposerAttachments({
  attachments,
  uploadingFiles,
  onRemove,
  onCancelUpload,
  visionWarning,
  transcriptionStatuses,
  onRetryTranscription,
  indexingStatuses,
}: ComposerAttachmentsProps) {
  const { t } = useT('chat');
  const [preview, setPreview] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  if (attachments.length === 0 && uploadingFiles.length === 0) return null;

  const hasImages = attachments.some((a) => isImage(a.fileType));

  return (
    <div>
      <Row gap={2} wrap align="center">
        {attachments.map((attachment) =>
          isAudioOrVideo(attachment.fileType) ? (
            <StagedMedia
              key={attachment.fileId}
              attachment={attachment}
              info={transcriptionStatuses?.get(attachment.fileId)}
              onRemove={() => onRemove(attachment.fileId)}
              {...(onRetryTranscription !== undefined
                ? {
                    onRetry: () => onRetryTranscription(attachment.fileId),
                  }
                : {})}
            />
          ) : isImage(attachment.fileType) ? (
            <StagedImage
              key={attachment.fileId}
              attachment={attachment}
              onOpen={(url) =>
                setPreview({ src: url, alt: attachment.fileName })
              }
              onRemove={() => onRemove(attachment.fileId)}
            />
          ) : (
            <StagedDocument
              key={attachment.fileId}
              attachment={attachment}
              info={indexingStatuses?.get(attachment.fileId)}
              onRemove={() => onRemove(attachment.fileId)}
            />
          ),
        )}
        {uploadingFiles.map((uploadId) => (
          <Row
            key={uploadId}
            gap={1}
            align="center"
            className="border-border bg-muted/40 h-9 shrink-0 rounded-lg border px-2"
          >
            <Loader2
              aria-hidden
              className="text-muted-foreground size-3.5 animate-spin motion-reduce:animate-none"
            />
            <Text variant="muted" className="text-xs">
              {t('uploadingFile')}
            </Text>
            <button
              type="button"
              onClick={() => onCancelUpload(uploadId)}
              aria-label={t('cancelUpload')}
              className="text-muted-foreground hover:text-foreground flex size-4 items-center justify-center"
            >
              <X aria-hidden className="size-3" />
            </button>
          </Row>
        ))}
      </Row>
      {visionWarning !== undefined && hasImages && (
        <Row gap={1} align="center" className="mt-1.5">
          <TriangleAlert
            aria-hidden
            className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500"
          />
          <Text variant="muted" className="text-xs">
            {visionWarning}
          </Text>
        </Row>
      )}
      {preview !== null && (
        <ImagePreviewDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setPreview(null);
          }}
          src={preview.src}
          alt={preview.alt}
        />
      )}
    </div>
  );
}
