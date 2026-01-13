'use client';

import { FileIcon, defaultStyles } from 'react-file-icon';
import type { DefaultExtensionType } from 'react-file-icon';
import { cn } from '@/lib/utils/cn';

interface DocumentIconProps {
  fileName: string;
  className?: string;
}

function getExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

export function DocumentIcon({ fileName, className = '' }: DocumentIconProps) {
  const ext = getExtension(fileName);
  const styles = defaultStyles[ext as DefaultExtensionType] || {};

  return (
    <div className={cn(className, 'size-7')}>
      <FileIcon extension={ext} {...styles} />
    </div>
  );
}
