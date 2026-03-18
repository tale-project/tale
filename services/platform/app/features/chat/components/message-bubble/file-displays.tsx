'use client';

import {
  Code2,
  Download,
  FileSpreadsheet,
  FileText,
  Image,
  Paperclip,
  Presentation,
  Settings2,
} from 'lucide-react';
import { memo } from 'react';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { VStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import {
  isTextBasedFile,
  getTextFileCategory,
  getFileExtensionLower,
} from '@/lib/utils/text-file-types';

import type { FileAttachment, FilePart } from './types';

import { useFileUrl } from '../../hooks/queries';

export function getFileTypeLabel(
  fileName: string,
  mediaType: string,
  t: (key: string) => string,
) {
  if (mediaType === 'application/pdf') return t('fileTypes.pdf');
  if (mediaType.includes('word')) return t('fileTypes.doc');
  if (mediaType.includes('presentation') || mediaType.includes('powerpoint'))
    return t('fileTypes.pptx');
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

  if (!displayUrl) {
    return (
      <div className="bg-muted flex max-w-[216px] items-center gap-2 rounded-lg px-2 py-1.5">
        <FileTypeIcon
          fileType={attachment.fileType}
          fileName={attachment.fileName}
        />
        <VStack className="min-w-0 flex-1">
          <Text as="div" variant="label" truncate>
            {attachment.fileName}
          </Text>
          <Text as="div" variant="caption">
            {getFileTypeLabel(attachment.fileName, attachment.fileType, t)}
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
      className="bg-muted hover:bg-muted/80 flex max-w-[216px] items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
    >
      <FileTypeIcon
        fileType={attachment.fileType}
        fileName={attachment.fileName}
      />
      <VStack className="min-w-0 flex-1">
        <Text as="div" variant="label" truncate>
          {attachment.fileName}
        </Text>
        <Text as="div" variant="caption">
          {getFileTypeLabel(attachment.fileName, attachment.fileType, t)}
        </Text>
      </VStack>
    </a>
  );
});

export const FilePartDisplay = memo(function FilePartDisplay({
  filePart,
  onImageClick,
}: {
  filePart: FilePart;
  onImageClick?: () => void;
}) {
  const { t } = useT('chat');
  const isImage = filePart.mediaType.startsWith('image/');

  if (isImage) {
    return (
      <button
        type="button"
        onClick={onImageClick}
        className="ring-border focus:ring-ring size-9 cursor-pointer overflow-hidden rounded-lg border-none bg-transparent p-0 ring-1 transition-opacity hover:opacity-80 focus:ring-2 focus:ring-offset-2 focus:outline-none"
        aria-label={t('fallback.image')}
      >
        <img
          src={filePart.url}
          alt={filePart.filename || t('fileTypes.image')}
          className="size-full object-cover"
        />
      </button>
    );
  }

  const fileName = filePart.filename || t('fallback.file');
  const fileTypeLabel = getFileTypeLabel(fileName, filePart.mediaType, t);

  return (
    <div className="bg-background border-border flex w-full items-center gap-3 rounded-xl border px-4 py-3 shadow-xs">
      <FileTypeIcon fileType={filePart.mediaType} fileName={fileName} />
      <VStack gap={1} className="min-w-0 flex-1">
        <p className="text-foreground truncate text-[13px] leading-tight font-medium">
          {fileName}
        </p>
        <p className="text-muted-foreground text-[11px] leading-tight">
          {fileTypeLabel}
        </p>
      </VStack>
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
  );
});
