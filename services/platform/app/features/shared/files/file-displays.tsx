'use client';

import { Row, VStack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import {
  AudioLines,
  Code2,
  Download,
  Eye,
  Film,
  FileSpreadsheet,
  FileText,
  Image,
  Paperclip,
  Pencil,
  Presentation,
  Settings2,
} from 'lucide-react';
import { memo, useState } from 'react';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useT } from '@/lib/i18n/client';
import { isAudioOrVideo } from '@/lib/shared/file-types';
import { formatFileSize, middleEllipsis } from '@/lib/utils/format/file';
import {
  isTextBasedFile,
  getTextFileCategory,
  getFileExtensionLower,
} from '@/lib/utils/text-file-types';

import { extractStorageFileId } from './storage-file-id';
import type { FileAttachment, FilePart } from './types';
import { useFileUrl } from './use-file-url';

export { formatFileSize, middleEllipsis } from '@/lib/utils/format/file';

export function getFileTypeLabel(
  fileName: string,
  mediaType: string,
  t: (key: string) => string,
) {
  if (mediaType === 'application/pdf') return t('fileTypes.pdf');
  if (mediaType.includes('word')) return t('fileTypes.doc');
  if (mediaType.includes('presentation') || mediaType.includes('powerpoint'))
    return t('fileTypes.pptx');
  if (
    mediaType.includes('spreadsheet') ||
    mediaType.includes('excel') ||
    mediaType === 'text/csv'
  ) {
    return mediaType === 'text/csv' ? t('fileTypes.csv') : t('fileTypes.xlsx');
  }
  if (mediaType === 'text/plain') return t('fileTypes.txt');
  if (mediaType.startsWith('audio/')) return t('fileTypes.audio');
  if (mediaType.startsWith('video/')) return t('fileTypes.video');
  if (isTextBasedFile(fileName, mediaType))
    return getFileExtensionLower(fileName).toUpperCase() || t('fileTypes.txt');
  return t('fileTypes.file');
}

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

export const FilePartDisplay = memo(function FilePartDisplay({
  filePart,
  onImageClick,
  onEditImage,
  isAssistantImage,
  organizationId,
}: {
  filePart: FilePart;
  onImageClick?: () => void;
  /**
   * Shortcut for image-generation agents: when set, renders an Edit button
   * overlay on the image. Clicking it promotes this image to the composer's
   * editing reference (pre-attached on next send).
   */
  onEditImage?: () => void;
  /**
   * True when this file part is an assistant-generated image. Generated images
   * are the focal output of a turn, so they render at a readable display size
   * rather than the small 36px thumbnail used for incidental images.
   */
  isAssistantImage?: boolean;
  organizationId?: string;
}) {
  const { t } = useT('chat');
  const [previewOpen, setPreviewOpen] = useState(false);
  const isImage = filePart.mediaType.startsWith('image/');
  // Generated-file parts persist a raw storage download URL, but the file
  // itself can be deleted later (e.g. the agent cleaning up run_code
  // intermediates with file_delete). Gate on live existence — getFileUrl
  // returns null for a deleted storage object — so cleaned-up files drop out
  // of the transcript instead of rendering broken thumbnails / dead download
  // cards. While the query is loading (undefined) keep rendering, so history
  // doesn't flash.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- storage id parsed from our own download URL; branded at runtime
  const fileId = extractStorageFileId(filePart.url);
  const { data: liveUrl } = useFileUrl(fileId);
  if (fileId !== undefined && liveUrl === null) return null;

  if (isImage) {
    // Assistant-generated images (and any image carrying an edit shortcut) are
    // the focal output of a turn — render them at a readable display size so
    // the result is legible and its Edit affordance is reachable. Incidental
    // images (e.g. on a user turn) keep the small 36px thumbnail.
    const isLarge = Boolean(isAssistantImage) || Boolean(onEditImage);
    const containerClasses = isLarge
      ? 'relative inline-block max-w-md overflow-hidden rounded-xl ring-1 ring-border'
      : 'group relative inline-block';
    const buttonClasses = isLarge
      ? 'block w-full cursor-pointer border-none bg-transparent p-0 transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
      : 'ring-border focus:ring-ring size-9 cursor-pointer overflow-hidden rounded-lg border-none bg-transparent p-0 ring-1 transition-opacity hover:opacity-80 focus:ring-2 focus:ring-offset-2 focus:outline-none';
    const imgClasses = isLarge
      ? 'block h-auto w-full object-contain'
      : 'size-full object-cover';
    // The Edit affordance is always visible and keyboard-focusable — never
    // hover-only — so it stays reachable on touch/coarse pointers.
    const editButtonClasses =
      'bg-background/90 ring-border text-foreground hover:bg-background focus-visible:ring-ring absolute top-2 right-2 flex size-8 items-center justify-center rounded-full shadow-sm ring-1 transition-colors focus:outline-none focus-visible:ring-2';

    return (
      <div className={containerClasses}>
        <button
          type="button"
          onClick={onImageClick}
          className={buttonClasses}
          aria-label={t('fallback.image')}
        >
          <img
            src={filePart.url}
            alt={filePart.filename || t('fileTypes.image')}
            className={imgClasses}
          />
        </button>
        {onEditImage && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEditImage();
            }}
            className={editButtonClasses}
            aria-label={t('imageEdit.editThis')}
            title={t('imageEdit.editThis')}
          >
            <Pencil className="size-4" strokeWidth={1.75} />
          </button>
        )}
      </div>
    );
  }

  const fileName = filePart.filename || t('fallback.file');
  const fileTypeLabel = getFileTypeLabel(fileName, filePart.mediaType, t);
  const canPreview = !!(fileId && organizationId);

  const body = (
    <>
      <FileTypeIcon fileType={filePart.mediaType} fileName={fileName} />
      <VStack gap={1} className="min-w-0 flex-1 text-left">
        <p
          className="text-foreground text-[13px] leading-tight font-medium"
          title={fileName}
        >
          {middleEllipsis(fileName, 32)}
        </p>
        <p className="text-muted-foreground text-[11px] leading-tight">
          {fileTypeLabel}
        </p>
      </VStack>
    </>
  );

  return (
    <>
      <Row
        gap={3}
        className="bg-background border-border w-full rounded-xl border px-4 py-3 shadow-xs"
      >
        {canPreview ? (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md border-none bg-transparent p-0 text-left transition-opacity hover:opacity-80 focus:outline-none focus-visible:opacity-80"
          >
            {body}
          </button>
        ) : (
          <Row gap={3} className="min-w-0 flex-1">
            {body}
          </Row>
        )}
        <a
          href={filePart.url}
          download={fileName}
          target="_blank"
          rel="noopener noreferrer"
          className="border-border text-muted-foreground hover:bg-muted flex shrink-0 items-center justify-center rounded-lg border p-2 transition-colors"
          aria-label={t('downloadFile')}
          onClick={(e) => e.stopPropagation()}
        >
          <Download className="size-4" strokeWidth={1.5} />
        </a>
      </Row>
      {canPreview && previewOpen && (
        <DocumentPreviewDialog
          open
          onOpenChange={(open) => {
            if (!open) setPreviewOpen(false);
          }}
          fileId={fileId}
          fileName={fileName}
        />
      )}
    </>
  );
});
