'use client';

import { XIcon } from 'lucide-react';

import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { formatFileSize, middleEllipsis } from '@/lib/utils/format/file';

import { DocumentIcon } from './document-icon';

interface FilePreviewCardProps {
  fileName: string;
  fileSize?: number;
  onRemove?: () => void;
  className?: string;
}

export function FilePreviewCard({
  fileName,
  fileSize,
  onRemove,
  className,
}: FilePreviewCardProps) {
  const { t } = useT('common');
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-border p-3',
        className,
      )}
    >
      <DocumentIcon fileName={fileName} className="size-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <Text variant="label" as="div" title={fileName}>
          {middleEllipsis(fileName, 32)}
        </Text>
        {fileSize != null && (
          <Text variant="caption" as="div">
            {formatFileSize(fileSize)}
          </Text>
        )}
      </div>
      {onRemove && (
        <IconButton
          icon={XIcon}
          aria-label={t('aria.removeFile')}
          onClick={onRemove}
          className="shrink-0"
        />
      )}
    </div>
  );
}
