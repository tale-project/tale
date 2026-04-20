'use client';

import {
  Code2,
  Download,
  FileSpreadsheet,
  FileText,
  Image,
  Paperclip,
  Pencil,
  Presentation,
  Settings2,
} from 'lucide-react';
import { memo, useState } from 'react';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { VStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog';
import { useT } from '@/lib/i18n/client';
import { formatFileSize, middleEllipsis } from '@/lib/utils/format/file';
import {
  isTextBasedFile,
  getTextFileCategory,
  getFileExtensionLower,
} from '@/lib/utils/text-file-types';

import { useFileUrl } from '../../hooks/queries';
import type { FileAttachment, FilePart } from './types';

function extractStorageFileId(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get('id') ?? undefined;
  } catch {
    return undefined;
  }
}

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
  onImageClick,
}: {
  attachment: FileAttachment;
  onImageClick?: () => void;
}) {
  const { t } = useT('chat');
  const { data: serverFileUrl } = useFileUrl(
    attachment.fileId,
    !!attachment.previewUrl,
  );
  const displayUrl = attachment.previewUrl || serverFileUrl || undefined;
  const isImage = attachment.fileType.startsWith('image/');

  if (isImage && !displayUrl) {
    return <Skeleton className="size-9 rounded-lg" />;
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

  if (!displayUrl) {
    return (
      <div className="bg-muted flex max-w-[280px] gap-3 rounded-lg px-3 py-2">
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
      </div>
    );
  }

  return (
    <a
      href={displayUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-muted hover:bg-muted/80 flex max-w-[280px] gap-3 rounded-lg px-3 py-2 transition-colors"
    >
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
    </a>
  );
});

export const FilePartDisplay = memo(function FilePartDisplay({
  filePart,
  onImageClick,
  onEditImage,
  organizationId,
}: {
  filePart: FilePart;
  onImageClick?: () => void;
  /**
   * Shortcut for image-generation agents: when set, renders an ↻ Edit button
   * overlay on image thumbnails. Clicking it promotes this image to the
   * composer's editing reference (pre-attached on next send).
   */
  onEditImage?: () => void;
  organizationId?: string;
}) {
  const { t } = useT('chat');
  const [previewOpen, setPreviewOpen] = useState(false);
  const isImage = filePart.mediaType.startsWith('image/');

  if (isImage) {
    // When onEditImage is provided, this is an assistant-generated image for
    // an image-generation agent — render it full-size so the output is the
    // focal point of the message. Otherwise keep the small 36px thumbnail
    // used for incidental images on chat messages.
    const isLarge = Boolean(onEditImage);
    const containerClasses = isLarge
      ? 'relative inline-block max-w-md overflow-hidden rounded-xl ring-1 ring-border'
      : 'group relative inline-block';
    const buttonClasses = isLarge
      ? 'block w-full cursor-pointer border-none bg-transparent p-0 transition-opacity hover:opacity-95 focus:outline-none'
      : 'ring-border focus:ring-ring size-9 cursor-pointer overflow-hidden rounded-lg border-none bg-transparent p-0 ring-1 transition-opacity hover:opacity-80 focus:ring-2 focus:ring-offset-2 focus:outline-none';
    const imgClasses = isLarge
      ? 'block h-auto w-full object-contain'
      : 'size-full object-cover';
    const editButtonClasses = isLarge
      ? 'bg-background/90 ring-border text-foreground hover:bg-background absolute top-2 right-2 flex size-8 items-center justify-center rounded-full shadow-sm ring-1 transition-opacity focus:outline-none'
      : 'bg-background/95 ring-border text-foreground hover:bg-background absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full opacity-0 shadow-sm ring-1 transition-opacity group-hover:opacity-100 focus:opacity-100 focus:outline-none';

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
            <Pencil
              className={isLarge ? 'size-4' : 'size-3'}
              strokeWidth={1.75}
            />
          </button>
        )}
      </div>
    );
  }

  const fileName = filePart.filename || t('fallback.file');
  const fileTypeLabel = getFileTypeLabel(fileName, filePart.mediaType, t);
  const fileId = extractStorageFileId(filePart.url);
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
      <div className="bg-background border-border flex w-full items-center gap-3 rounded-xl border px-4 py-3 shadow-xs">
        {canPreview ? (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md border-none bg-transparent p-0 text-left transition-opacity hover:opacity-80 focus:outline-none focus-visible:opacity-80"
          >
            {body}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
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
      </div>
      {canPreview && previewOpen && (
        <DocumentPreviewDialog
          open
          onOpenChange={(open) => {
            if (!open) setPreviewOpen(false);
          }}
          organizationId={organizationId}
          fileId={fileId}
          fileName={fileName}
        />
      )}
    </>
  );
});
