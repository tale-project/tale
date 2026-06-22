'use client';

import { Loader } from 'lucide-react';
import { memo, type RefObject } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useT } from '@/lib/i18n/client';

import { useTextareaTokenRects } from '../../hooks/use-textarea-token-rects';

export interface PasteImageChip {
  status: 'ready' | 'uploading';
  previewUrl?: string;
}

interface PasteImageOverlayProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  /** Chip data keyed by the `[N]` token id. */
  chips: Map<number, PasteImageChip>;
  /** Open the full-size preview for a pasted image (clicked chip). */
  onOpen: (id: number) => void;
}

/**
 * Paints a small rectangle badge — a square image thumbnail with the marker
 * index (`1.`) to its right — over each `[N]` token in the composer textarea.
 * Clicking opens the preview. Each badge is clamped to the footprint the token
 * + its reserve spaces occupy in the text (`useTextareaTokenRects` measures
 * `[N]` plus trailing spaces), so it never overlaps the following words. The
 * wrapper is `pointer-events-none`; only the badge button is interactive, so
 * text editing passes straight through. Tokens without chip data (e.g. a `[5]`
 * the user typed) are left as plain text.
 */
export const PasteImageOverlay = memo(function PasteImageOverlay({
  textareaRef,
  value,
  chips,
  onOpen,
}: PasteImageOverlayProps) {
  const { t } = useT('chat');
  const active = chips.size > 0;
  const layout = useTextareaTokenRects(textareaRef, value, active);
  if (!active || !layout) return null;

  return (
    <div
      className="pointer-events-none absolute overflow-hidden"
      style={{
        left: layout.layer.left,
        top: layout.layer.top,
        width: layout.layer.width,
        height: layout.layer.height,
      }}
    >
      {layout.tokens.map((token, index) => {
        const chip = chips.get(token.id);
        if (!chip) return null;
        // Clamp to the token + reserve-spaces footprint so the rectangle badge
        // can't bleed over following text; the badge sizes to its content and
        // is clipped if the footprint is narrower.
        const footprint = {
          left: token.left,
          top: token.top,
          width: token.width,
          height: token.height,
        };
        const badgeStyle = { height: token.height };

        if (chip.status !== 'ready' || !chip.previewUrl) {
          return (
            <span
              key={`${token.id}-${index}`}
              className="absolute overflow-hidden"
              style={footprint}
            >
              <span
                aria-hidden
                data-token-id={token.id}
                style={badgeStyle}
                className="ring-border bg-muted flex aspect-square items-center justify-center rounded-md shadow-sm ring-1"
              >
                <Loader className="text-muted-foreground size-3 animate-spin" />
              </span>
            </span>
          );
        }

        return (
          <span
            key={`${token.id}-${index}`}
            className="absolute overflow-hidden"
            style={footprint}
          >
            <Tooltip content={`${t('viewImage')} ${token.id}`} side="top">
              <button
                type="button"
                // Mouse-only affordance — keyboard/AT use the textarea text and
                // the attachment tray, so the badge stays out of the tab order.
                tabIndex={-1}
                data-token-id={token.id}
                onClick={() => onOpen(token.id)}
                aria-label={`${t('viewImage')} ${token.id}`}
                style={badgeStyle}
                className="ring-border bg-muted hover:ring-ring pointer-events-auto flex items-center gap-1 overflow-hidden rounded-md pr-1.5 shadow-sm ring-1 transition hover:ring-2"
              >
                <img
                  src={chip.previewUrl}
                  alt=""
                  className="aspect-square h-full shrink-0 object-cover"
                />
                <span className="text-foreground text-[11px] leading-none font-semibold tabular-nums">
                  {token.id}.
                </span>
              </button>
            </Tooltip>
          </span>
        );
      })}
    </div>
  );
});
