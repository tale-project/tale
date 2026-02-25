'use client';

import { XIcon } from 'lucide-react';

import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { Text } from '@/app/components/ui/typography/text';
import { cn } from '@/lib/utils/cn';

import { DocumentIcon } from './document-icon';

interface FilePreviewCardProps {
  fileName: string;
  fileSize?: number;
  onRemove?: () => void;
  className?: string;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilePreviewCard({
  fileName,
  fileSize,
  onRemove,
  className,
}: FilePreviewCardProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-border p-3',
        className,
      )}
    >
      <DocumentIcon fileName={fileName} className="size-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <Text variant="label" as="span" truncate>
          {fileName}
        </Text>
        {fileSize != null && (
          <Text variant="caption" as="span">
            {formatFileSize(fileSize)}
          </Text>
        )}
      </div>
      {onRemove && (
        <IconButton
          icon={XIcon}
          aria-label="Remove file"
          onClick={onRemove}
          className="shrink-0"
        />
      )}
    </div>
  );
}
