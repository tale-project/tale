'use client';

import { XIcon } from 'lucide-react';
import { memo } from 'react';

import { useT } from '@/lib/i18n/client';

import type { AttachedFile } from './types';

import { getFileIcon } from './types';

interface FileAttachmentsListProps {
  files: AttachedFile[];
  onRemove: (fileId: string) => void;
}

function formatFileSize(
  bytes: number,
  tCommon: (key: string) => string,
): string {
  if (bytes === 0) return `0 ${tCommon('fileSize.bytes')}`;
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const units = [
    tCommon('fileSize.bytes'),
    tCommon('fileSize.kb'),
    tCommon('fileSize.mb'),
    tCommon('fileSize.gb'),
  ];
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
}

export const FileAttachmentsList = memo(function FileAttachmentsList({
  files,
  onRemove,
}: FileAttachmentsListProps) {
  const { t: tCommon } = useT('common');

  if (files.length === 0) return null;

  return (
    <div className="border-border border-t py-2">
      <div className="flex flex-wrap gap-2">
        {files.map((file) => (
          <div
            key={file.id}
            className="bg-muted flex items-center gap-2 rounded-md px-3 py-2 text-sm"
          >
            {getFileIcon(file.type)}
            <span className="max-w-[200px] truncate">{file.file?.name}</span>
            <span className="text-muted-foreground text-xs">
              {file.file && formatFileSize(file.file.size, tCommon)}
            </span>
            <button
              type="button"
              onClick={() => onRemove(file.id)}
              className="hover:bg-background ml-1 rounded p-0.5"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
});
