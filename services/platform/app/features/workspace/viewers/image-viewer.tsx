'use client';

import { Row } from '@tale/ui/layout';
import { memo } from 'react';

import { formatFileSize } from '@/lib/utils/format/file';

import { DownloadUrlAction } from './canvas-file-actions';
import { CanvasViewerFrame } from './canvas-viewer-frame';

interface ImageViewerProps {
  url: string;
  alt: string;
  /** Byte size for the action card; omit when unknown (no size label shown). */
  size?: number;
}

function ImageViewerComponent({ url, alt, size }: ImageViewerProps) {
  return (
    <CanvasViewerFrame
      sizeLabel={size !== undefined ? formatFileSize(size) : undefined}
      actions={<DownloadUrlAction filename={alt} url={url} />}
    >
      <Row
        gap={0}
        justify="center"
        className="bg-checkerboard h-full w-full overflow-auto p-4"
      >
        <img
          src={url}
          alt={alt}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
      </Row>
    </CanvasViewerFrame>
  );
}

export const ImageViewer = memo(ImageViewerComponent);
