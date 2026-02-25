'use client';

import { useCallback, useEffect, useRef } from 'react';

interface UseAutoScrollOptions {
  /**
   * Whether auto-scroll should be active (e.g., during streaming)
   */
  enabled: boolean;
  /**
   * Threshold in pixels from bottom to consider "at bottom"
   * User is considered "at bottom" if within this distance
   */
  threshold?: number;
}

interface UseAutoScrollReturn {
  /**
   * Ref to attach to the scrollable container
   */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Ref to attach to the content container (observed for size changes)
   */
  contentRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Manually scroll to bottom
   */
  scrollToBottom: () => void;
  /**
   * Whether user is currently at bottom (for showing scroll button)
   */
  isAtBottom: () => boolean;
}

/**
 * useAutoScroll - Position-based auto-scrolling for streaming content.
 *
 * Uses a single principle: "Was the user at the bottom before content grew?"
 * - Yes → scroll to the new bottom (follow the stream)
 * - No → don't scroll (user is reading above)
 *
 * Position is the sole source of truth — no input-event sniffing, no flags,
 * no direction tracking. This eliminates race conditions between wheel, touch,
 * and scroll events and works correctly with ALL scroll methods (mouse wheel,
 * trackpad, scrollbar drag, keyboard, programmatic scroll).
 *
 * Nested scrollable containers (e.g. code blocks) are handled automatically:
 * when a nested container absorbs the scroll, the outer container's scrollTop
 * doesn't change, so wasAtBottomRef stays correct.
 */
export function useAutoScroll({
  enabled,
  threshold = 100,
}: UseAutoScrollOptions): UseAutoScrollReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Whether the user was "at bottom" as of the last scroll position update.
  // Read by the ResizeObserver to decide if content growth should auto-scroll.
  const wasAtBottomRef = useRef(true);

  // Track content height to only auto-scroll on growth (not shrinkage).
  const lastContentHeightRef = useRef(0);
  // Track enabled transitions for end-of-streaming scroll.
  const wasEnabledRef = useRef(false);

  const isAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;

    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight <= threshold;
  }, [threshold]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }, []);

  /**
   * Scroll tracking + ResizeObserver in a single effect.
   *
   * The scroll handler keeps wasAtBottomRef in sync with the user's position.
   * The ResizeObserver reads wasAtBottomRef (set BEFORE growth) to decide
   * whether to follow content growth — avoiding the isAtBottom()-after-growth
   * trap that would break auto-scroll on large DOM changes (>threshold).
   *
   * Only scrolls on content growth, not shrinkage, to avoid unnecessary
   * adjustments when elements are removed (e.g. streaming cursor).
   */
  useEffect(() => {
    const content = contentRef.current;
    const container = containerRef.current;
    if (!content || !container || !enabled) return;

    // Reset to 0 so the first observation triggers a scroll-to-bottom.
    // Do NOT use getBoundingClientRect().height here — it includes padding,
    // while ResizeObserver's contentRect.height does not. The mismatch would
    // cause the first N pixels of growth (= 2 × padding) to be undetected.
    lastContentHeightRef.current = 0;
    wasAtBottomRef.current = isAtBottom();

    const handleScroll = () => {
      wasAtBottomRef.current = isAtBottom();
    };

    const resizeObserver = new ResizeObserver((entries) => {
      const newHeight = entries[0]?.contentRect?.height ?? 0;
      const changed = newHeight !== lastContentHeightRef.current;
      lastContentHeightRef.current = newHeight;

      // Scroll on ANY height change (not just growth) while at bottom.
      // During streaming, temporary height decreases can occur (e.g.,
      // markdown table structure transitions, code block max-height
      // threshold). Scrolling on shrinkage keeps the user anchored to
      // the bottom. This is safe because the observer is only active
      // while `enabled` is true (i.e., during streaming).
      if (changed && wasAtBottomRef.current) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'instant',
        });
        // Sync for back-to-back observer callbacks that may fire
        // before the asynchronous scroll event from scrollTo above.
        wasAtBottomRef.current = true;
      }
    });

    resizeObserver.observe(content);
    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', handleScroll);
    };
  }, [enabled, isAtBottom]);

  /**
   * When streaming ends, do one deferred scroll to catch final DOM changes
   * (e.g. copy/info buttons appearing after ResizeObserver disconnects).
   */
  useEffect(() => {
    if (enabled) {
      wasEnabledRef.current = true;
    } else if (wasEnabledRef.current && wasAtBottomRef.current) {
      wasEnabledRef.current = false;
      const container = containerRef.current;
      if (container) {
        const raf = requestAnimationFrame(() => {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'instant',
          });
        });
        return () => cancelAnimationFrame(raf);
      }
    }
  }, [enabled]);

  return {
    containerRef,
    contentRef,
    scrollToBottom,
    isAtBottom,
  };
}
