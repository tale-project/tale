'use client';

import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { XIcon } from 'lucide-react';
import { memo } from 'react';

import {
  formatFileSize,
  middleEllipsis,
} from '@/app/features/shared/files/file-displays';
import { useT } from '@/lib/i18n/client';

import type { AttachedFile } from './types';
import { attachedFileName, attachedFileSize, getFileIcon } from './types';

interface FileAttachmentsListProps {
  files: AttachedFile[];
  onRemove: (fileId: string) => void;
}

export const FileAttachmentsList = memo(function FileAttachmentsList({
  files,
  onRemove,
}: FileAttachmentsListProps) {
  const { t: tCommon } = useT('common');

  if (files.length === 0) return null;

  return (
    <div className="border-border border-t py-2">
      <Row gap={2} align="stretch" wrap>
        {files.map((file) => {
          const name = attachedFileName(file);
          const size = attachedFileSize(file);
          return (
            <Row
              key={file.id}
              gap={2}
              className="bg-muted rounded-md px-3 py-2 text-sm"
            >
              {getFileIcon(file.type)}
              <Text as="span" title={name}>
                {middleEllipsis(name, 28)}
              </Text>
              <Text as="span" variant="caption">
                {size !== undefined && formatFileSize(size)}
              </Text>
              {/* Named by the whole file name — the chip's own label may be
                  cut short, and an unnamed ✕ reads as just "button". */}
              <button
                type="button"
                onClick={() => onRemove(file.id)}
                aria-label={tCommon('aria.removeNamed', { name })}
                className="hover:bg-background focus-visible:ring-ring ml-1 rounded p-0.5 focus-visible:ring-2 focus-visible:outline-none"
              >
                <XIcon className="size-3" aria-hidden="true" />
              </button>
            </Row>
          );
        })}
      </Row>
    </div>
  );
});
