'use client';

import { ViewDialog } from '@tale/ui/dialog/view-dialog';
import { formatFileSize, middleEllipsis } from '@tale/ui/format';
import { Row, VStack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import {
  AudioLines,
  Code2,
  Eye,
  Film,
  FileSpreadsheet,
  FileText,
  Image,
  Paperclip,
  Presentation,
  Settings2,
} from 'lucide-react';
import { memo, useState } from 'react';

import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useT } from '@/lib/i18n/client';
import { isAudioOrVideo } from '@/lib/shared/file-types';
import {
  isTextBasedFile,
  getTextFileCategory,
} from '@/lib/utils/text-file-types';

import type { FileAttachment } from './types';
import { useFileUrl } from './use-file-url';

export { formatFileSize, middleEllipsis } from '@tale/ui/format';

function getFileIconInfo(fileType: string, fileName: string) {
  const lowerFileName = fileName.toLowerCase();
  if (fileType.startsWith('image/'))
    return { Icon: Image, bgColor: 'bg-blue-50', iconColor: 'text-blue-600' };
  if (fileType === 'application/pdf')
    return { Icon: FileText, bgColor: 'bg-red-50', iconColor: 'text-red-600' };
  if (
    fileType.includes('word') ||
    lowerFileName.endsWith('.doc') ||
    lowerFileName.endsWith('.docx')
  )
    return {
      Icon: FileText,
      bgColor: 'bg-blue-50',
      iconColor: 'text-blue-600',
    };
  if (
    fileType.includes('presentation') ||
    fileType.includes('powerpoint') ||
    lowerFileName.endsWith('.ppt') ||
    lowerFileName.endsWith('.pptx')
  )
    return {
      Icon: Presentation,
      bgColor: 'bg-orange-50',
      iconColor: 'text-orange-600',
    };
  if (
    fileType.includes('spreadsheet') ||
    fileType.includes('excel') ||
    lowerFileName.endsWith('.xlsx') ||
    lowerFileName.endsWith('.xls') ||
    lowerFileName.endsWith('.csv')
  )
    return {
      Icon: FileSpreadsheet,
      bgColor: 'bg-green-50',
      iconColor: 'text-green-600',
    };
  if (fileType === 'text/plain')
    return {
      Icon: FileText,
      bgColor: 'bg-gray-50',
      iconColor: 'text-gray-500',
    };
  if (fileType.startsWith('audio/'))
    return {
      Icon: AudioLines,
      bgColor: 'bg-purple-50',
      iconColor: 'text-purple-600',
    };
  if (fileType.startsWith('video/'))
    return {
      Icon: Film,
      bgColor: 'bg-indigo-50',
      iconColor: 'text-indigo-600',
    };
  if (isTextBasedFile(fileName, fileType)) {
    const category = getTextFileCategory(fileName);
    if (category === 'code')
      return {
        Icon: Code2,
        bgColor: 'bg-purple-50',
        iconColor: 'text-purple-600',
      };
    if (category === 'config')
      return {
        Icon: Settings2,
        bgColor: 'bg-yellow-50',
        iconColor: 'text-yellow-600',
      };
    if (category === 'data')
      return {
        Icon: FileSpreadsheet,
        bgColor: 'bg-green-50',
        iconColor: 'text-green-600',
      };
    return {
      Icon: FileText,
      bgColor: 'bg-gray-50',
      iconColor: 'text-gray-500',
    };
  }
  return {
    Icon: Paperclip,
    bgColor: 'bg-gray-50',
    iconColor: 'text-gray-500',
  };
}

export function FileTypeIcon({
  fileType,
  fileName,
}: {
  fileType: string;
  fileName: string;
}) {
  const { Icon, bgColor, iconColor } = getFileIconInfo(fileType, fileName);

  return (
    <div
      className={`${bgColor} flex size-9 shrink-0 items-center justify-center rounded-lg`}
    >
      <Icon className={`${iconColor} size-[18px]`} strokeWidth={1.5} />
    </div>
  );
}

export const FileAttachmentDisplay = memo(function FileAttachmentDisplay({
  attachment,
  organizationId,
  onImageClick,
}: {
  attachment: FileAttachment;
  organizationId?: string;
  onImageClick?: () => void;
}) {
  const { t } = useT('chat');
  const isImage = attachment.fileType.startsWith('image/');
  const isMedia = isAudioOrVideo(attachment.fileType);
  const isDocument = !isImage && !isMedia;
  // Document chips open the in-app preview dialog (whose header owns the
  // named Download), so no URL is resolved for them here. Only images
  // (thumbnail + lightbox) and audio/video (the browser's inline player)
  // still need one — unnamed, because an attachment disposition would break
  // inline rendering.
  const { data: serverFileUrl } = useFileUrl(
    attachment.fileId,
    !!attachment.previewUrl || isDocument,
  );
  const displayUrl = attachment.previewUrl || serverFileUrl || undefined;

  // For audio/video attachments in sent messages, fetch the transcript via
  // the existing plural query (skip when not media to avoid subscriptions).
  const { data: audioMetadataList } = useBackendQuery(
    'file_metadata/queries:getByStorageIds',
    isMedia && organizationId
      ? { organizationId, storageIds: [attachment.fileId] }
      : 'skip',
  );
  const audioMetadata = audioMetadataList?.[0];
  const canPreviewTranscript =
    isMedia &&
    audioMetadata?.transcriptionStatus === 'completed' &&
    !!audioMetadata.transcript;
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  if (isImage && !displayUrl) {
    return (
      <Skeletonize loading>
        <SkeletonBox>
          <div className="size-9 rounded-lg" />
        </SkeletonBox>
      </Skeletonize>
    );
  }

  if (isImage) {
    return (
      <button
        type="button"
        onClick={onImageClick}
        className="ring-border focus:ring-ring size-9 cursor-pointer overflow-hidden rounded-lg border-none bg-transparent p-0 ring-1 transition-opacity hover:opacity-80 focus:ring-2 focus:ring-offset-2 focus:outline-none"
        aria-label={t('fallback.image')}
      >
        <img
          src={displayUrl}
          alt={attachment.fileName}
          className="size-full object-cover"
        />
      </button>
    );
  }

  const displayName = middleEllipsis(attachment.fileName, 28);
  const sizeLabel = formatFileSize(attachment.fileSize);

  const chipBody = (
    <>
      <FileTypeIcon
        fileType={attachment.fileType}
        fileName={attachment.fileName}
      />
      <VStack className="min-w-0 flex-1">
        <Text as="div" variant="label" title={attachment.fileName}>
          {displayName}
        </Text>
        <Text as="div" variant="caption">
          {sizeLabel}
        </Text>
      </VStack>
    </>
  );

  // Documents open the same preview dialog the documents surfaces use —
  // rendered in place when a renderer exists; everything else lands on the
  // dialog's "not available" state with its header Download button.
  if (isDocument) {
    return (
      <>
        <Row
          gap={3}
          className="bg-muted hover:bg-muted/80 max-w-[280px] rounded-lg px-3 py-2 transition-colors"
        >
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="focus-visible:ring-ring flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md border-none bg-transparent p-0 text-left focus-visible:ring-2 focus-visible:outline-none"
          >
            {chipBody}
          </button>
        </Row>
        {previewOpen && (
          <DocumentPreviewDialog
            open
            onOpenChange={(open) => {
              if (!open) setPreviewOpen(false);
            }}
            fileId={attachment.fileId}
            fileName={attachment.fileName}
          />
        )}
      </>
    );
  }

  const viewTranscriptButton = canPreviewTranscript ? (
    <button
      type="button"
      aria-label={t('transcription.viewTranscript')}
      title={t('transcription.viewTranscript')}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setTranscriptOpen(true);
      }}
      className="text-muted-foreground hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-full transition-colors"
    >
      <Eye className="size-3.5" />
    </button>
  ) : null;

  const transcriptDialog =
    canPreviewTranscript && audioMetadata ? (
      <ViewDialog
        open={transcriptOpen}
        onOpenChange={setTranscriptOpen}
        title={attachment.fileName}
        description={
          audioMetadata.transcriptionDurationSec
            ? t('transcription.previewSubtitle', {
                seconds: Math.round(audioMetadata.transcriptionDurationSec),
              })
            : undefined
        }
        size="lg"
      >
        <Text
          as="div"
          variant="body"
          className="max-h-[60vh] overflow-y-auto leading-relaxed whitespace-pre-wrap"
        >
          {audioMetadata.transcript}
        </Text>
      </ViewDialog>
    ) : null;

  if (!displayUrl) {
    return (
      <>
        <Row gap={3} className="bg-muted max-w-[280px] rounded-lg px-3 py-2">
          {chipBody}
          {viewTranscriptButton}
        </Row>
        {transcriptDialog}
      </>
    );
  }

  return (
    <>
      <Row
        gap={3}
        className="bg-muted hover:bg-muted/80 max-w-[280px] rounded-lg px-3 py-2 transition-colors"
      >
        <a
          href={displayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          {chipBody}
        </a>
        {viewTranscriptButton}
      </Row>
      {transcriptDialog}
    </>
  );
});
