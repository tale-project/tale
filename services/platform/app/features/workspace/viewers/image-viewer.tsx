'use client';

import { Row } from '@tale/ui/layout';
import { memo } from 'react';

interface ImageViewerProps {
  url: string;
  alt: string;
}

function ImageViewerComponent({ url, alt }: ImageViewerProps) {
  return (
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
  );
}

export const ImageViewer = memo(ImageViewerComponent);
