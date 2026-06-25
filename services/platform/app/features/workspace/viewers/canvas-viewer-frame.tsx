'use client';

import { memo, useEffect, useRef, useState, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

interface CanvasViewerFrameProps {
  /** Human-readable file size shown at the left of the card; omit to hide it. */
  sizeLabel?: string;
  /** The kind-specific action <Button>s for this file. */
  actions: ReactNode;
  /** The viewer content. Fills the pane and owns its own scroll. */
  children: ReactNode;
}

// The card sits `bottom-3` (12px) above the frame's bottom edge; reserve a gap
// of one more `gap-3` (12px) between the card's top and the last line so they
// never touch. The content gutter = measured card height + these two insets.
const CARD_BOTTOM_INSET = 12;
const CARD_TOP_GAP = 12;
// Seed the gutter for the first paint (≈ a one-row card) so content doesn't
// briefly render under where the card will land before the measurement lands.
const INITIAL_CARD_HEIGHT = 44;

/**
 * Shared shell for every canvas file viewer: the content pane plus the floating,
 * bottom-right action card. Hoisted out of `renderable-file-viewer.tsx` so the
 * code/markdown/html/svg/mermaid/image viewers all present one identical control
 * surface — previously the code viewer used a full-width top strip while the
 * renderable viewer used this card. Viewers pass their own buttons as `actions`;
 * the frame owns the position, the bottom gutter that keeps the last line of
 * content clear of the card, and the size label.
 *
 * The card is capped to the viewer width and wraps, so on a narrow (docked)
 * viewer the buttons stack to a second row instead of overflowing the column and
 * being clipped. Because that makes the card height variable, the content gutter
 * is measured from the live card height (a fixed pad would be too short for a
 * wrapped card and tuck the final line behind the toolbar).
 */
function CanvasViewerFrameComponent({
  sizeLabel,
  actions,
  children,
}: CanvasViewerFrameProps) {
  const { t } = useT('chat');
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(INITIAL_CARD_HEIGHT);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return undefined;
    const measure = () => setCardHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Bottom gutter the height of the floating card so the last line of
          content can scroll clear of it instead of hiding behind it. */}
      <div
        className="min-h-0 flex-1 overflow-hidden"
        style={{ paddingBottom: cardHeight + CARD_BOTTOM_INSET + CARD_TOP_GAP }}
      >
        {children}
      </div>

      <div
        ref={cardRef}
        className="border-border bg-background/95 absolute right-3 bottom-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-end gap-1 rounded-lg border p-1 shadow-md backdrop-blur"
        role="group"
        aria-label={t('canvas.fileActionsAriaLabel', {
          defaultValue: 'File actions',
        })}
      >
        {sizeLabel !== undefined && (
          <span
            className="text-muted-foreground px-2 text-xs tabular-nums"
            aria-label={t('canvas.fileSizeAriaLabel', {
              defaultValue: 'File size',
            })}
          >
            {sizeLabel}
          </span>
        )}
        {actions}
      </div>
    </div>
  );
}

export const CanvasViewerFrame = memo(CanvasViewerFrameComponent);
