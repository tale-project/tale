'use client';

import { Button } from '@tale/ui/button';
import { TextQuote } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { useT } from '@/lib/i18n/client';

interface QuoteAnchor {
  text: string;
  /** Viewport coordinates of the selection's top-center. */
  x: number;
  y: number;
}

/**
 * Floating "Quote" affordance: when the user selects text inside a chat
 * message, a small button appears above the selection. Clicking it hands the
 * snippet to the surface (`onQuote`), which stages it as the removable chip
 * over the composer; the chip is prepended as a markdown blockquote on the
 * next send.
 *
 * One instance per surface. Selections are honored only inside transcript
 * rows (`data-testid="chat-message"`) — never the composer or chrome.
 */
export function SelectionQuoteButton({
  onQuote,
}: {
  onQuote: (text: string) => void;
}) {
  const { t } = useT('chat');
  const [anchor, setAnchor] = useState<QuoteAnchor | null>(null);

  useEffect(() => {
    const refresh = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setAnchor(null);
        return;
      }
      const text = selection.toString().trim();
      if (!text) {
        setAnchor(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const element = node instanceof Element ? node : node.parentElement;
      // Only selections that live inside the message stream — ignore the
      // composer, headers, and every other surface.
      if (!element?.closest('[data-testid="chat-message"]')) {
        setAnchor(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setAnchor(null);
        return;
      }
      setAnchor({ text, x: rect.left + rect.width / 2, y: rect.top });
    };

    // mouseup / touchend fire after the selection settles; selectionchange
    // catches keyboard selections and collapses (hide on empty). Scrolling
    // anywhere hides the button — its fixed anchor is stale the moment the
    // selection moves under it (capture: scroll does not bubble).
    const onPointerUp = () => requestAnimationFrame(refresh);
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) setAnchor(null);
    };
    const onScroll = () => setAnchor(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAnchor(null);
    };

    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchend', onPointerUp);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('scroll', onScroll, {
      passive: true,
      capture: true,
    });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mouseup', onPointerUp);
      document.removeEventListener('touchend', onPointerUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  if (!anchor || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="pointer-events-auto fixed z-50 -translate-x-1/2 -translate-y-full"
      style={{ left: anchor.x, top: anchor.y - 8 }}
    >
      <Button
        size="sm"
        variant="secondary"
        className="gap-1.5 rounded-full shadow-lg"
        // Prevent the mousedown from collapsing the selection before the
        // click handler reads it.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          onQuote(anchor.text);
          window.getSelection()?.removeAllRanges();
          setAnchor(null);
        }}
      >
        <TextQuote className="size-3.5" aria-hidden="true" />
        {t('quote.button')}
      </Button>
    </div>,
    document.body,
  );
}
