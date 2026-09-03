'use client';

/**
 * Compact file chip shared by chat bubbles and conversation messages:
 * type icon, truncated filename (full name on hover), optional detail line,
 * optional trailing action. Never shows a MIME string.
 */

import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';
import { middleEllipsis } from '@/lib/utils/format/file';

import { FileTypeIcon } from './file-displays';

const FILE_NAME_MAX = 28;

export function AttachmentFileChip({
  fileName,
  contentType = '',
  detail,
  trailing,
  className,
}: {
  fileName: string;
  contentType?: string;
  /** Secondary line — size, status copy, etc. Never a MIME string. */
  detail?: string;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <Row
      gap={2}
      className={cn('bg-background rounded-lg border p-2', className)}
    >
      <FileTypeIcon fileType={contentType} fileName={fileName} />
      <div className="min-w-0 flex-1">
        <Text variant="label-sm" title={fileName}>
          {middleEllipsis(fileName, FILE_NAME_MAX)}
        </Text>
        {detail !== undefined && detail !== '' && (
          <Text variant="caption" className="text-[10px]">
            {detail}
          </Text>
        )}
      </div>
      {trailing}
    </Row>
  );
}
