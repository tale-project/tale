'use client';

import { Button } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import { Maximize, Minus, Plus, X } from 'lucide-react';
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

  // Zoom cluster modelled on the automation editor's corner controls
  // (`flow-canvas.tsx`): shared `Button` primitives, `Minus` / `Plus` to step
  // zoom and `Maximize` to fit, with a zoom-percentage readout between them.
  const controls = (
    <div className={cn('flex items-center gap-1.5', toolbarClassName)}>
      <Button
        variant="secondary"
        size="icon"
        title={t('flow.zoomOut')}
        tooltipSide="top"
        onClick={zoomOut}
        disabled={!canZoomOut}
      >
        <Minus className="size-4" />
      </Button>
      <Text
        as="span"
        align="center"
        className="bg-background ring-border text-foreground min-w-[3.25rem] rounded-md px-2 py-1.5 text-sm tabular-nums shadow-sm ring-1"
      >
        {Math.round(zoom * 100)}%
      </Text>
      <Button
        variant="secondary"
        size="icon"
        title={t('flow.zoomIn')}
        tooltipSide="top"
        onClick={zoomIn}
        disabled={!canZoomIn}
      >
        <Plus className="size-4" />
      </Button>
      {/* Fit-to-screen — always enabled (re-fits even at 100%). */}
      <Button
        variant="secondary"
        size="icon"
        title={t('flow.resetView')}
        tooltipSide="top"
        onClick={reset}
      >
        <Maximize className="size-4" />
      </Button>
    </div>
  );

  return (
    <div className={cn('relative flex min-h-0 flex-1 flex-col', className)}>
      {toolbarPosition === 'overlay' && (
        <div className="absolute top-4 right-4 left-4 z-20 flex items-start justify-between gap-2">
          {headerContent ?? <span />}
          {onClose && (
            <Button
              variant="secondary"
              size="icon"
              onClick={onClose}
              // `common.imagePreview.*` was never added; the canonical close
              // label lives at `common.aria.close`.
              title={t('aria.close')}
              tooltipSide="bottom"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      )}

      {toolbarPosition === 'inline' && (
        <div className="mb-2 flex justify-end">{controls}</div>
      )}

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

      {/* Floating bottom-center cluster for the dialog (`overlay`) and document
          preview (`bottom`) layouts. `pointer-events-none` on the wrapper keeps
          drag-to-pan working everywhere except on the controls themselves. */}
      {(toolbarPosition === 'overlay' || toolbarPosition === 'bottom') && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
          <div className="pointer-events-auto">{controls}</div>
        </div>
      )}
    </div>
  );
});
