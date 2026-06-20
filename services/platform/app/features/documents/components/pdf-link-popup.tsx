'use client';

import { Copy, ExternalLink } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';

export interface PdfLinkPopupState {
  url: string;
  /** Viewport (clientX/Y) coordinates of the click that opened the popup. */
  x: number;
  y: number;
}

/**
 * Small floating popup shown when a link inside the PDF is clicked. Instead of
 * navigating away immediately (which is jarring inside a document preview), we
 * surface the destination and let the user choose to copy it or open it in a
 * new tab.
 *
 * Rendered inline (NOT portalled to <body>) so it stays inside the preview
 * dialog's DOM + React tree. A body-level portal lands outside Radix's dialog
 * content, where the dialog marks it `aria-hidden` and its dismissable layer
 * treats clicks as "outside" — which was stealing the button clicks. The
 * trade-off: the dialog content box is `transform`ed, so it (not the viewport)
 * becomes the containing block for our `position: fixed`. We correct for that
 * after first paint by measuring the drift between where the popup actually
 * rendered and the intended viewport coordinates.
 */
export const PdfLinkPopup = ({
  state,
  onClose,
}: {
  state: PdfLinkPopupState;
  onClose: () => void;
}) => {
  const { t } = useT('documents');
  const ref = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [correction, setCorrection] = useState({ dx: 0, dy: 0 });

  // Anchor near the click, clamped into the viewport so the popup never spills
  // off-screen for links near the page edges.
  const POPUP_WIDTH = 232;
  const targetLeft = Math.min(
    Math.max(8, state.x),
    window.innerWidth - POPUP_WIDTH - 8,
  );
  const targetTop = Math.min(state.y + 6, window.innerHeight - 72);

  // If a transformed ancestor shifted our fixed-position box, measure the drift
  // and offset by it so the popup lands at the intended viewport coordinates.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = targetLeft - rect.left;
    const dy = targetTop - rect.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      setCorrection((prev) => ({ dx: prev.dx + dx, dy: prev.dy + dy }));
    }
  }, [targetLeft, targetTop]);

  // Dismiss on outside click, scroll, or Escape. Registration is deferred to
  // the next frame so the very click that opened the popup can't immediately
  // close it.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (
        ref.current &&
        target instanceof Node &&
        !ref.current.contains(target)
      ) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const frame = requestAnimationFrame(() => {
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('keydown', onKeyDown);
      window.addEventListener('scroll', onClose, true);
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
      window.setTimeout(onClose, 900);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const onVisit = () => {
    window.open(state.url, '_blank', 'noopener,noreferrer');
    onClose();
  };

  return (
    // The click/pointerdown handlers are containment only (stop the dialog's
    // dismissable layer from treating these as outside-clicks); they carry no
    // interactive semantics of their own — the real controls are the focusable
    // <button>s inside.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- containment only; interactive children are the buttons
    <div
      ref={ref}
      role="dialog"
      style={{
        position: 'fixed',
        left: targetLeft + correction.dx,
        top: targetTop + correction.dy,
        width: POPUP_WIDTH,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="ring-border bg-muted text-popover-foreground animate-in fade-in-0 zoom-in-95 z-60 cursor-default rounded-md p-1 shadow-md ring-1 select-none motion-reduce:animate-none"
    >
      <div
        className="text-muted-foreground truncate px-1.5 pt-1 pb-1.5 text-[11px]"
        title={state.url}
      >
        {state.url}
      </div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onCopy}
          className="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded px-2 py-1 text-xs transition hover:bg-white/10"
        >
          <Copy className="size-3" />
          {copied ? t('preview.link.copied') : t('preview.link.copy')}
        </button>
        <button
          type="button"
          onClick={onVisit}
          className="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded px-2 py-1 text-xs transition hover:bg-white/10"
        >
          <ExternalLink className="size-3" />
          {t('preview.link.visit')}
        </button>
      </div>
    </div>
  );
};
