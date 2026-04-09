'use client';

import { XIcon } from 'lucide-react';
import { memo } from 'react';

import { Text } from '@/app/components/ui/typography/text';
import {
  formatFileSize,
  middleEllipsis,
} from '@/app/features/chat/components/message-bubble/file-displays';

import type { AttachedFile } from './types';
import { getFileIcon } from './types';

interface FileAttachmentsListProps {
  files: AttachedFile[];
  onRemove: (fileId: string) => void;
}

export const FileAttachmentsList = memo(function FileAttachmentsList({
  files,
  onRemove,
}: FileAttachmentsListProps) {
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
            <Text as="span" title={file.file?.name}>
              {middleEllipsis(file.file?.name ?? '', 28)}
            </Text>
            <Text as="span" variant="caption">
              {file.file && formatFileSize(file.file.size)}
            </Text>
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
