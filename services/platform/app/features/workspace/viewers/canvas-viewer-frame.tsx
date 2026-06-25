'use client';

import { memo, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

interface CanvasViewerFrameProps {
  /** Human-readable file size shown at the left of the card; omit to hide it. */
  sizeLabel?: string;
  /** The kind-specific action <Button>s for this file. */
  actions: ReactNode;
  /** The viewer content. Fills the pane and owns its own scroll. */
  children: ReactNode;
}

/**
 * Shared shell for every canvas file viewer: the content pane plus the floating,
 * bottom-right action card. Hoisted out of `renderable-file-viewer.tsx` so the
 * code/markdown/html/svg/mermaid/image viewers all present one identical control
 * surface — previously the code viewer used a full-width top strip while the
 * renderable viewer used this card. Viewers pass their own buttons as `actions`;
 * the frame owns the position, the `pb-14` gutter that keeps the last line of
 * content clear of the card, and the size label.
 */
function CanvasViewerFrameComponent({
  sizeLabel,
  actions,
  children,
}: CanvasViewerFrameProps) {
  const { t } = useT('chat');
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* `pb-14` reserves a gutter the height of the floating card so the last
          line of content can scroll clear of it instead of hiding behind it. */}
      <div className="min-h-0 flex-1 overflow-hidden pb-14">{children}</div>

      <div
        className="border-border bg-background/95 absolute right-3 bottom-3 z-10 flex items-center gap-1 rounded-lg border p-1 shadow-md backdrop-blur"
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
