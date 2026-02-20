'use client';

import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { useRef, useState, useEffect, useCallback, memo } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

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
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(
    (open: boolean) => {
      onOpenChange(open);
      if (!open) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    },
    [onOpenChange],
  );

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => {
      const next = Math.max(prev - ZOOM_STEP, MIN_ZOOM);
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (zoom <= 1) return;
      e.preventDefault();
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      panStart.current = { x: pan.x, y: pan.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [zoom, pan],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPan({ x: panStart.current.x + dx, y: panStart.current.y + dy });
    },
    [isDragging],
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        setZoom((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
      } else {
        setZoom((prev) => {
          const next = Math.max(prev - ZOOM_STEP, MIN_ZOOM);
          if (next <= 1) setPan({ x: 0, y: 0 });
          return next;
        });
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
      className="bg-muted flex flex-col border-0 p-0 ring-0 sm:p-0"
      customHeader={
        <div className="absolute top-4 right-4 left-4 z-10 flex items-center justify-between">
          <span className="text-foreground/80 max-w-[60%] truncate text-sm">
            {alt}
          </span>
          <div className="bg-muted flex items-center gap-1 rounded-lg p-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomOut}
              disabled={zoom <= MIN_ZOOM}
              className="text-foreground size-8 disabled:opacity-50"
              aria-label={t('imageViewer.zoomOut')}
            >
              <ZoomOut className="size-4" />
            </Button>
            <span className="text-foreground min-w-[3rem] text-center text-sm">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomIn}
              disabled={zoom >= MAX_ZOOM}
              className="text-foreground size-8 disabled:opacity-50"
              aria-label={t('imageViewer.zoomIn')}
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleResetZoom}
              disabled={zoom === 1}
              className="text-foreground size-8 disabled:opacity-50"
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
        className={cn(
          'flex flex-1 items-center justify-center overflow-hidden p-8 pt-16',
          zoom > 1 ? 'cursor-grab' : 'cursor-default',
          isDragging && 'cursor-grabbing',
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <img
          src={src}
          alt={alt}
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.15s ease-out',
          }}
          className="max-h-full max-w-full object-contain select-none"
          draggable={false}
        />
      </div>
    </Dialog>
  );
});
