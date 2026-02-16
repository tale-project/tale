'use client';

import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { useRef, useState, useEffect, useCallback, memo } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

interface ImagePreviewDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
}

export const ImagePreviewDialog = memo(function ImagePreviewDialog({
  isOpen,
  onOpenChange,
  src,
  alt,
}: ImagePreviewDialogProps) {
  const { t } = useT('chat');
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(
    (open: boolean) => {
      onOpenChange(open);
      if (!open) {
        setZoom(1);
      }
    },
    [onOpenChange],
  );

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        setZoom((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
      } else {
        setZoom((prev) => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={handleClose}
      title={t('imagePreview')}
      size="wide"
      hideClose
      className="flex flex-col border-0 bg-black/95 p-0 ring-0 sm:p-0"
      customHeader={
        <div className="absolute top-4 right-4 left-4 z-10 flex items-center justify-between">
          <span className="max-w-[60%] truncate text-sm text-white/80">
            {alt}
          </span>
          <div className="flex items-center gap-1 rounded-lg bg-black/50 p-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomOut}
              disabled={zoom <= MIN_ZOOM}
              className="size-8 text-white hover:bg-white/20 disabled:opacity-50"
              aria-label={t('imageViewer.zoomOut')}
            >
              <ZoomOut className="size-4" />
            </Button>
            <span className="min-w-[3rem] text-center text-sm text-white">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomIn}
              disabled={zoom >= MAX_ZOOM}
              className="size-8 text-white hover:bg-white/20 disabled:opacity-50"
              aria-label={t('imageViewer.zoomIn')}
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleResetZoom}
              disabled={zoom === 1}
              className="size-8 text-white hover:bg-white/20 disabled:opacity-50"
              aria-label={t('imageViewer.resetZoom')}
            >
              <RotateCcw className="size-4" />
            </Button>
          </div>
        </div>
      }
    >
      <div
        ref={containerRef}
        className="flex flex-1 items-center justify-center overflow-auto p-8 pt-16"
      >
        <img
          src={src}
          alt={alt}
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'center center',
            transition: 'transform 0.15s ease-out',
          }}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
      </div>
    </Dialog>
  );
});
