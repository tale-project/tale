'use client';

import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { memo } from 'react';

import { useZoomPan } from '@/app/hooks/use-zoom-pan';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { Text } from '../typography/text';

interface ZoomPanViewerProps {
  /** Image source URL */
  src: string;
  /** Alt text for the image */
  alt: string;
  /** Additional class for the outermost container */
  className?: string;
  /**
   * Toolbar layout:
   * - `'overlay'` positions absolutely on top-right (dialog use case)
   * - `'bottom'` sticky bottom-center floating pill (document preview use case)
   * - `'inline'` renders in normal flow above the image (embedded use case)
   */
  toolbarPosition?: 'overlay' | 'bottom' | 'inline';
  /** Additional class for the toolbar wrapper */
  toolbarClassName?: string;
  /** Content rendered to the left of the toolbar in overlay mode (e.g. alt text label) */
  headerContent?: React.ReactNode;
  /** When this value changes, zoom/pan resets. Pass dialog open state or image src. */
  resetTrigger?: unknown;
  /** Additional class for the `<img>` element */
  imageClassName?: string;
  /** Called when the image finishes loading */
  onLoad?: () => void;
  /** Called when the image fails to load */
  onError?: () => void;
}

export const ZoomPanViewer = memo(function ZoomPanViewer({
  src,
  alt,
  className,
  toolbarPosition = 'overlay',
  toolbarClassName,
  headerContent,
  resetTrigger,
  imageClassName,
  onLoad,
  onError,
}: ZoomPanViewerProps) {
  const { t } = useT('common');
  const {
    zoom,
    isDragging,
    containerRef,
    zoomIn,
    zoomOut,
    reset,
    pointerHandlers,
    canZoomIn,
    canZoomOut,
    isZoomed,
    transformStyle,
  } = useZoomPan({ resetTrigger });

  const isBottom = toolbarPosition === 'bottom';

  const buttonClass = isBottom
    ? 'grid size-8 place-items-center rounded-full transition hover:bg-white/10 disabled:opacity-35'
    : 'text-foreground size-8 disabled:opacity-50';

  const toolbar = (
    <div
      className={cn(
        isBottom
          ? 'bg-background text-foreground flex items-center gap-2 rounded-full px-4 py-2 shadow-xl ring-1 ring-white/10'
          : 'bg-muted flex items-center gap-1 rounded-lg p-1',
        toolbarClassName,
      )}
    >
      <button
        onClick={zoomOut}
        disabled={!canZoomOut}
        className={buttonClass}
        aria-label={t('imagePreview.zoomOut')}
      >
        <ZoomOut className="size-4" />
      </button>
      <Text
        as="span"
        align="center"
        className="min-w-[3rem] text-sm tabular-nums"
      >
        {Math.round(zoom * 100)}%
      </Text>
      <button
        onClick={zoomIn}
        disabled={!canZoomIn}
        className={buttonClass}
        aria-label={t('imagePreview.zoomIn')}
      >
        <ZoomIn className="size-4" />
      </button>
      <button
        onClick={reset}
        disabled={!isZoomed}
        className={buttonClass}
        aria-label={t('imagePreview.resetZoom')}
      >
        <RotateCcw className="size-4" />
      </button>
    </div>
  );

  const renderToolbar = () => {
    switch (toolbarPosition) {
      case 'overlay':
        return (
          <div className="absolute top-4 right-4 left-4 z-10 flex items-center justify-between">
            {headerContent ?? <span />}
            {toolbar}
          </div>
        );
      case 'bottom':
        return null;
      case 'inline':
        return <div className="mb-2 flex justify-end">{toolbar}</div>;
    }
  };

  return (
    <div className={cn('relative flex flex-1 flex-col min-h-0', className)}>
      {renderToolbar()}

      <div
        ref={containerRef}
        className={cn(
          'flex flex-1 items-center justify-center overflow-hidden',
          isZoomed ? 'cursor-grab' : 'cursor-default',
          isDragging && 'cursor-grabbing',
        )}
        {...pointerHandlers}
      >
        <img
          src={src}
          alt={alt}
          style={transformStyle}
          className={cn(
            'max-h-full max-w-full object-contain select-none',
            imageClassName,
          )}
          draggable={false}
          onLoad={onLoad}
          onError={onError}
        />
      </div>

      {isBottom && (
        <div className="sticky bottom-4 z-50 flex w-full justify-center">
          {toolbar}
        </div>
      )}
    </div>
  );
});
