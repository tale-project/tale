'use client';

import { memo } from 'react';

interface ImageViewerProps {
  url: string;
  alt: string;
}

function ImageViewerComponent({ url, alt }: ImageViewerProps) {
  return (
    <div className="bg-checkerboard flex h-full w-full items-center justify-center overflow-auto p-4">
      <img
        src={url}
        alt={alt}
        className="max-h-full max-w-full object-contain"
        draggable={false}
      />
    </div>
  );
}

export const ImageViewer = memo(ImageViewerComponent);
