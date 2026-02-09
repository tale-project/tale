'use client';

import type { DefaultExtensionType } from 'react-file-icon';

import { FileIcon, defaultStyles } from 'react-file-icon';

import { extractExtension } from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';

interface DocumentIconProps {
  fileName: string;
  className?: string;
  isFolder?: boolean;
}

function OneDriveFolderIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M2 6C2 4.89543 2.89543 4 4 4H9.17157C9.70201 4 10.2107 4.21071 10.5858 4.58579L12 6H20C21.1046 6 22 6.89543 22 8V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V6Z"
        fill="#F5BA42"
      />
      <path
        d="M2 8H22V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18V8Z"
        fill="#F9D262"
      />
    </svg>
  );
}

export function DocumentIcon({
  fileName,
  className = '',
  isFolder = false,
}: DocumentIconProps) {
  if (isFolder) {
    return (
      <div className={cn(className, 'size-7 flex items-center justify-center')}>
        <OneDriveFolderIcon className="size-6" />
      </div>
    );
  }

  const ext = extractExtension(fileName) ?? '';
  const styles = defaultStyles[ext as DefaultExtensionType] || {};

  return (
    <div className={cn(className, 'size-7')}>
      <FileIcon extension={ext} {...styles} />
    </div>
  );
}
