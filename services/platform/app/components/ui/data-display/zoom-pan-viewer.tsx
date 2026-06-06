'use client';

import { Text } from '@tale/ui/text';
import { RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { memo, useCallback } from 'react';

import { useZoomPan } from '@/app/hooks/use-zoom-pan';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

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
  /**
   * When provided, renders a close (✕) button at the far right of the
   * overlay header. Use from dialog/lightbox contexts where the wrapping
   * `<Dialog>` is rendered with `hideClose` and the viewer owns the
   * dismiss affordance. Ignored when `toolbarPosition` is not `'overlay'`.
   */
  onClose?: () => void;
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
  onClose,
}: ZoomPanViewerProps) {
  const { t } = useT('common');
  const {
    zoom,
    isDragging,
    containerRef,
    zoomIn,
    zoomOut,
    reset,
    toggleZoom,
    pointerHandlers,
    canZoomIn,
    canZoomOut,
    isZoomed,
    transformStyle,
  } = useZoomPan({ resetTrigger });

  // Double-click toggles between fit (1x) and the configured zoom-in target,
  // anchored to the click point so the spot the user double-clicked stays
  // put as the image grows around it. Drag-while-zoomed sometimes ends with
  // a synthetic dblclick if the user lifts the pointer fast — guard on
  // `isDragging` so a pan release doesn't accidentally reset the zoom.
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isDragging) return;
      toggleZoom({ x: e.clientX, y: e.clientY });
    },
    [isDragging, toggleZoom],
  );

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
        type="button"
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
        type="button"
        onClick={zoomIn}
        disabled={!canZoomIn}
        className={buttonClass}
        aria-label={t('imagePreview.zoomIn')}
      >
        <ZoomIn className="size-4" />
      </button>
      <button
        type="button"
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
          <div className="absolute top-4 right-4 left-4 z-10 flex items-center justify-between gap-2">
            {headerContent ?? <span />}
            <div className="flex items-center gap-2">
              {toolbar}
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="bg-muted text-foreground hover:bg-muted/80 grid size-8 place-items-center rounded-lg transition"
                  // `common.imagePreview.*` is a missing group — the sibling
                  // zoom buttons fall through to literal keys (pre-existing
                  // bug). Use the canonical `common.aria.close` until the
                  // group is filled in.
                  aria-label={t('aria.close')}
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          </div>
        );
      case 'bottom':
        return null;
      case 'inline':
        return <div className="mb-2 flex justify-end">{toolbar}</div>;
      default:
        return undefined;
    }
  };

  return (
    <div className={cn('relative flex flex-1 flex-col min-h-0', className)}>
      {renderToolbar()}

      <div
        ref={containerRef}
        tabIndex={isZoomed ? 0 : -1}
        onDoubleClick={handleDoubleClick}
        className={cn(
          'flex flex-1 items-center justify-center overflow-hidden outline-none',
          // At fit-level the pointer hints "double-click to zoom"; once zoomed
          // it flips to grab / grabbing during drag-pan. `zoom-in` is a real
          // CSS cursor recognized by all evergreen browsers.
          isZoomed ? 'cursor-grab' : 'cursor-zoom-in',
          isDragging && 'cursor-grabbing',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2',
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
