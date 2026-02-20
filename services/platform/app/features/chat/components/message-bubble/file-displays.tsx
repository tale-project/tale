'use client';

import { memo } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  isTextBasedFile,
  getTextFileCategory,
  getFileExtensionLower,
} from '@/lib/utils/text-file-types';

import { useFileUrl } from '../../hooks/queries';
import type { FileAttachment, FilePart } from './types';

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

export function FileTypeIcon({
  fileType,
  fileName,
}: {
  fileType: string;
  fileName: string;
}) {
  const { t } = useT('chat');

  const getFileTypeInfo = () => {
    if (fileType.startsWith('image/'))
      return {
        icon: '🖼️',
        label: t('fileTypes.image'),
        bgColor: 'bg-blue-100',
      };
    if (fileType === 'application/pdf')
      return { icon: '📄', label: t('fileTypes.pdf'), bgColor: 'bg-red-100' };
    if (
      fileType.includes('word') ||
      fileName.endsWith('.doc') ||
      fileName.endsWith('.docx')
    )
      return { icon: '📝', label: t('fileTypes.doc'), bgColor: 'bg-blue-100' };
    if (
      fileType.includes('presentation') ||
      fileType.includes('powerpoint') ||
      fileName.endsWith('.ppt') ||
      fileName.endsWith('.pptx')
    )
      return {
        icon: '📊',
        label: t('fileTypes.pptx'),
        bgColor: 'bg-orange-100',
      };
    if (fileType === 'text/plain')
      return { icon: '📄', label: t('fileTypes.txt'), bgColor: 'bg-gray-100' };
    if (isTextBasedFile(fileName, fileType)) {
      const category = getTextFileCategory(fileName);
      const ext = getFileExtensionLower(fileName).toUpperCase();
      if (category === 'code')
        return {
          icon: '💻',
          label: ext || t('fileTypes.code'),
          bgColor: 'bg-purple-100',
        };
      if (category === 'config')
        return {
          icon: '⚙️',
          label: ext || t('fileTypes.config'),
          bgColor: 'bg-yellow-100',
        };
      if (category === 'data')
        return {
          icon: '📊',
          label: ext || t('fileTypes.data'),
          bgColor: 'bg-green-100',
        };
      if (category === 'markup')
        return {
          icon: '📝',
          label: ext || t('fileTypes.markup'),
          bgColor: 'bg-teal-100',
        };
      return {
        icon: '📄',
        label: ext || t('fileTypes.txt'),
        bgColor: 'bg-gray-100',
      };
    }
    return { icon: '📎', label: t('fileTypes.file'), bgColor: 'bg-gray-100' };
  };

  const { icon, label, bgColor } = getFileTypeInfo();

  return (
    <div
      className={`${bgColor} flex size-8 shrink-0 items-center justify-center rounded-lg`}
    >
      <div className="flex flex-col items-center">
        <span className="text-xs leading-none">{icon}</span>
        <span className="text-foreground/80 mt-0.5 text-[8px] font-medium leading-none">
          {label}
        </span>
      </div>
    </div>
  );
}

export const FileAttachmentDisplay = memo(function FileAttachmentDisplay({
  attachment,
}: {
  attachment: FileAttachment;
}) {
  const { t } = useT('chat');
  const { data: serverFileUrl } = useFileUrl(
    attachment.fileId,
    !!attachment.previewUrl,
  );
  const displayUrl = attachment.previewUrl || serverFileUrl;
  const isImage = attachment.fileType.startsWith('image/');

  if (isImage) {
    if (!displayUrl) {
      return (
        <div className="bg-muted size-11 animate-pulse overflow-hidden rounded-lg" />
      );
    }

    return (
      <div className="bg-muted size-11 overflow-hidden rounded-lg bg-cover bg-center bg-no-repeat">
        <img
          src={displayUrl}
          alt={attachment.fileName}
          className="size-full object-cover"
        />
      </div>
    );
  }

  if (!displayUrl) {
    return (
      <div className="bg-muted flex max-w-[216px] items-center gap-2 rounded-lg px-2 py-1.5">
        <FileTypeIcon
          fileType={attachment.fileType}
          fileName={attachment.fileName}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="text-foreground truncate text-sm font-medium">
            {attachment.fileName}
          </div>
          <div className="text-muted-foreground text-xs">
            {getFileTypeLabel(attachment.fileName, attachment.fileType, t)}
          </div>
        </div>
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
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="text-foreground truncate text-sm font-medium">
          {attachment.fileName}
        </div>
        <div className="text-muted-foreground text-xs">
          {getFileTypeLabel(attachment.fileName, attachment.fileType, t)}
        </div>
      </div>
    </a>
  );
});

export const FilePartDisplay = memo(function FilePartDisplay({
  filePart,
}: {
  filePart: FilePart;
}) {
  const { t } = useT('chat');
  const isImage = filePart.mediaType.startsWith('image/');

  if (isImage) {
    return (
      <div className="bg-muted size-11 overflow-hidden rounded-lg bg-cover bg-center bg-no-repeat">
        <img
          src={filePart.url}
          alt={filePart.filename || t('fileTypes.image')}
          className="size-full object-cover"
        />
      </div>
    );
  }

  return (
    <a
      href={filePart.url}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-muted hover:bg-muted/80 flex max-w-[13.5rem] items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
    >
      <FileTypeIcon
        fileType={filePart.mediaType}
        fileName={filePart.filename || t('fileTypes.file')}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="text-foreground truncate text-sm font-medium">
          {filePart.filename || t('fileTypes.file')}
        </div>
        <div className="text-muted-foreground text-xs">
          {getFileTypeLabel(filePart.filename || '', filePart.mediaType, t)}
        </div>
      </div>
    </a>
  );
});
