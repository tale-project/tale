'use client';

import { Button } from '@tale/ui/button';
import { TextQuote } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { useT } from '@/lib/i18n/client';

import { useChatLayout } from '../context/chat-layout-context';

interface SelectionQuoteButtonProps {
  /** The chat scroll container; selections outside it are ignored. */
  containerRef: RefObject<HTMLElement | null>;
}

interface QuoteAnchor {
  text: string;
  /** Viewport coordinates of the selection's top-center. */
  x: number;
  y: number;
}

/**
 * Floating "Quote" affordance: when the user selects text inside a chat
 * message, a small button appears above the selection. Clicking it stages
 * the snippet as a removable chip over the composer (via chat-layout
 * context); the chip is prepended as a markdown blockquote on the next send.
 */
export function SelectionQuoteButton({
  containerRef,
}: SelectionQuoteButtonProps) {
  const { t } = useT('chat');
  const { setQuotedText } = useChatLayout();
  const [anchor, setAnchor] = useState<QuoteAnchor | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

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
      // Only honor selections that live inside the message stream — ignore
      // selections in the composer, headers, or other surfaces.
      if (!container.contains(range.commonAncestorContainer)) {
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
    // catches keyboard selections and collapses (hide on empty).
    const onPointerUp = () => requestAnimationFrame(refresh);
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) setAnchor(null);
    };
    const onScroll = () => setAnchor(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAnchor(null);
    };

    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchend', onPointerUp);
    document.addEventListener('selectionchange', onSelectionChange);
    container.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mouseup', onPointerUp);
      document.removeEventListener('touchend', onPointerUp);
      document.removeEventListener('selectionchange', onSelectionChange);
      container.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [containerRef]);

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
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setQuotedText(anchor.text);
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
