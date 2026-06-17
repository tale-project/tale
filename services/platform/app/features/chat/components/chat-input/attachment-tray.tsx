'use client';

import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Eye, Loader, RotateCcw, X } from 'lucide-react';

import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { isAudioOrVideo } from '@/lib/shared/file-types';
import { middleEllipsis } from '@/lib/utils/format/file';

import type { FileAttachment } from '../../hooks/use-convex-file-upload';
import type { KbMention } from '../../hooks/use-kb-mentions';
import {
  AttachmentStatusLabel,
  type IndexingStatusInfo,
  type TranscriptionStatusInfo,
} from './attachment-status-label';

interface TranscriptPreview {
  fileName: string;
  transcript: string;
  durationSec?: number;
}

interface AttachmentTrayProps {
  kbMentionsEnabled: boolean;
  kbMentions?: KbMention[];
  removeKbMention?: (documentId: Id<'documents'>) => void;
  imageAttachments: FileAttachment[];
  fileAttachments: FileAttachment[];
  uploadingFiles: string[];
  transcriptionStatuses?: Map<Id<'_storage'>, TranscriptionStatusInfo>;
  indexingStatuses?: Map<Id<'_storage'>, IndexingStatusInfo>;
  retryAudioTranscription?: (fileId: Id<'_storage'>) => void;
  removeAttachment: (fileId: Id<'_storage'>) => void;
  onPreviewImage: (preview: { src: string; alt: string }) => void;
  onPreviewTranscript: (preview: TranscriptPreview) => void;
}

/**
 * The staged-attachments strip above the textarea: `@`-mention chips, image
 * thumbnails, file chips (with their two-phase transcription/indexing status),
 * and in-flight upload spinners. Fully prop-driven — preview opening is lifted
 * to the composer via callbacks so this stays a presentational leaf.
 */
export function AttachmentTray({
  kbMentionsEnabled,
  kbMentions,
  removeKbMention,
  imageAttachments,
  fileAttachments,
  uploadingFiles,
  transcriptionStatuses,
  indexingStatuses,
  retryAudioTranscription,
  removeAttachment,
  onPreviewImage,
  onPreviewTranscript,
}: AttachmentTrayProps) {
  const { t: tChat } = useT('chat');
  const { t: tComposer } = useT('composer');

  return (
    <HStack gap={1} wrap className="mb-2">
      {kbMentionsEnabled &&
        kbMentions?.map((mention) => (
          <div
            key={mention.documentId}
            className="bg-muted group relative flex max-w-[280px] items-center gap-3 rounded-lg px-3 py-2"
          >
            <DocumentIcon
              fileName={
                mention.extension
                  ? `${mention.title}.${mention.extension}`
                  : mention.title
              }
              mimeType={mention.fileType}
            />
            <VStack className="min-w-0 flex-1 gap-1">
              <Text as="div" variant="label" title={mention.title}>
                {middleEllipsis(mention.title, 28)}
              </Text>
              <Text
                as="span"
                variant="caption"
                className="text-muted-foreground/50"
              >
                {tComposer('kbMention.chipLabel')}
              </Text>
            </VStack>
            <button
              type="button"
              aria-label={tComposer('kbMention.removeMention', {
                title: mention.title,
              })}
              onClick={() => removeKbMention?.(mention.documentId)}
              className="bg-background absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="text-muted-foreground size-3" />
            </button>
          </div>
        ))}
      {imageAttachments.map((attachment) => (
        <div
          key={attachment.fileId}
          className="ring-border group relative size-9 overflow-hidden rounded-lg ring-1"
        >
          <button
            type="button"
            aria-label={tChat('viewImage')}
            onClick={() =>
              attachment.previewUrl &&
              onPreviewImage({
                src: attachment.previewUrl,
                alt: attachment.fileName,
              })
            }
            className="bg-muted focus:ring-ring size-full cursor-pointer transition-opacity hover:opacity-90 focus:ring-2 focus:ring-offset-2 focus:outline-none"
          >
            {attachment.previewUrl ? (
              <img
                src={attachment.previewUrl}
                alt={attachment.fileName}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center bg-gradient-to-br from-blue-100 to-blue-200">
                <span className="text-xs text-blue-600">
                  {tChat('fileTypes.image')}
                </span>
              </div>
            )}
          </button>
          <button
            type="button"
            aria-label={tChat('removeAttachment')}
            onClick={() => removeAttachment(attachment.fileId)}
            className="bg-background absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <X className="text-muted-foreground size-3" />
          </button>
        </div>
      ))}

      {fileAttachments.map((attachment) => {
        const audioInfo = isAudioOrVideo(attachment.fileType)
          ? transcriptionStatuses?.get(attachment.fileId)
          : undefined;
        const canPreviewTranscript =
          audioInfo?.status === 'completed' && !!audioInfo.transcript;

        return (
          <div
            key={attachment.fileId}
            className="bg-muted group relative flex max-w-[280px] items-center gap-3 rounded-lg px-3 py-2"
          >
            <DocumentIcon fileName={attachment.fileName} />
            <VStack className="min-w-0 flex-1 gap-1">
              <Text as="div" variant="label" title={attachment.fileName}>
                {middleEllipsis(attachment.fileName, 28)}
              </Text>
              <AttachmentStatusLabel
                attachment={attachment}
                transcriptionStatuses={transcriptionStatuses}
                indexingStatuses={indexingStatuses}
              />
            </VStack>
            <button
              type="button"
              aria-label={tChat('removeAttachment')}
              onClick={() => removeAttachment(attachment.fileId)}
              className="bg-background absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="text-muted-foreground size-3" />
            </button>
            {canPreviewTranscript && (
              <button
                type="button"
                aria-label={tChat('transcription.viewTranscript')}
                title={tChat('transcription.viewTranscript')}
                onClick={() =>
                  onPreviewTranscript({
                    fileName: attachment.fileName,
                    transcript: audioInfo?.transcript ?? '',
                    durationSec: audioInfo?.durationSec,
                  })
                }
                className="bg-background text-muted-foreground hover:text-foreground absolute right-0.5 bottom-0.5 flex size-5 items-center justify-center rounded-full transition-colors"
              >
                <Eye className="size-3" />
              </button>
            )}
            {audioInfo?.status === 'failed' && retryAudioTranscription && (
              // Retry a failed transcription — reuses the persisted
              // `_storage` blob (no re-upload). Mutually exclusive
              // with the view-transcript (Eye) button, which only
              // renders on `completed`, so both can share the
              // bottom-right corner. Mirrors the video-link chip's
              // retry affordance.
              <button
                type="button"
                aria-label={tChat('transcription.retry')}
                title={tChat('transcription.retry')}
                onClick={() => retryAudioTranscription(attachment.fileId)}
                className="bg-background text-muted-foreground hover:text-foreground absolute right-0.5 bottom-0.5 flex size-5 items-center justify-center rounded-full transition-colors"
              >
                <RotateCcw className="size-3" />
              </button>
            )}
          </div>
        );
      })}

      {uploadingFiles.map((fileId) => (
        <div
          key={fileId}
          role="status"
          aria-label={tChat('uploadingFile')}
          className="border-border bg-muted flex size-9 items-center justify-center overflow-hidden rounded-lg border"
        >
          <Loader className="text-muted-foreground size-4 animate-spin" />
        </div>
      ))}
    </HStack>
  );
}
