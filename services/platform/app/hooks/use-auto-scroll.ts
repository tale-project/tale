'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

interface UseAutoScrollOptions {
  /**
   * Whether auto-scroll should be active (e.g., during streaming).
   * Used only for end-of-streaming scroll correction via useLayoutEffect.
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
   * Programmatic scroll to a specific position. Sets the programmatic scroll
   * guard so the scroll event doesn't corrupt wasAtBottomRef, and enables
   * auto-follow for subsequent content growth.
   */
  scrollTo: (top: number) => void;
  /**
   * Whether user is currently at bottom (for showing scroll button)
   */
  isAtBottom: () => boolean;
}

// Scroll events arriving within this window after a programmatic scrollTo are
// treated as programmatic (wasAtBottomRef stays true). A single scrollTo can
// fire multiple scroll events in some browsers; a boolean guard only covers
// the first. 50ms gives ~3 frames of margin for instant scrolls while being
// short enough to never swallow a real user scroll.
const PROGRAMMATIC_SCROLL_WINDOW_MS = 50;

/**
 * useAutoScroll - Position-based auto-scrolling for changing content.
 *
 * Core invariant: "If the user is at the bottom and content height changes,
 * follow it." Both growth AND shrinkage are followed — the distinction between
 * them was a source of bugs when streaming ends but typewriter drain continues.
 *
 * A timestamp-based programmatic scroll guard distinguishes our own scrollTo
 * calls from user scrolls, preventing async scroll events from falsely
 * updating the position state.
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
  // Read by the ResizeObserver to decide if height changes should auto-scroll.
  const wasAtBottomRef = useRef(true);

  // Timestamp of the last programmatic scrollTo call. Scroll events arriving
  // within PROGRAMMATIC_SCROLL_WINDOW_MS are treated as ours, preventing
  // isAtBottom() from corrupting wasAtBottomRef when content grows between
  // the scrollTo and the async scroll event.
  const programmaticScrollAtRef = useRef(0);

  // Track content height to detect changes.
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

    wasAtBottomRef.current = true;
    programmaticScrollAtRef.current = performance.now();
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'instant',
    });
  }, []);

  const scrollTo = useCallback((top: number) => {
    const container = containerRef.current;
    if (!container) return;

    wasAtBottomRef.current = true;
    programmaticScrollAtRef.current = performance.now();
    container.scrollTo({ top, behavior: 'instant' });
  }, []);

  /**
   * Scroll tracking + ResizeObserver — runs continuously.
   *
   * The scroll handler keeps wasAtBottomRef in sync with the user's position.
   * The ResizeObserver reads wasAtBottomRef (set BEFORE height change) to
   * decide whether to follow — avoiding the isAtBottom()-after-growth trap
   * that would break auto-scroll on large DOM changes (>threshold).
   *
   * Both growth and shrinkage are followed when the user is at the bottom.
   * This handles streaming, typewriter drain, new messages, markdown
   * restructuring, and end-of-streaming DOM mutations uniformly.
   */
  useEffect(() => {
    const content = contentRef.current;
    const container = containerRef.current;
    if (!content || !container) return;

    wasAtBottomRef.current = isAtBottom();

    const handleScroll = () => {
      if (
        performance.now() - programmaticScrollAtRef.current <
        PROGRAMMATIC_SCROLL_WINDOW_MS
      ) {
        wasAtBottomRef.current = true;
        return;
      }
      wasAtBottomRef.current = isAtBottom();
    };

    const resizeObserver = new ResizeObserver((entries) => {
      const newHeight = entries[0]?.contentRect?.height ?? 0;
      const changed = newHeight !== lastContentHeightRef.current;
      lastContentHeightRef.current = newHeight;

      if (changed && wasAtBottomRef.current) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'instant',
        });
        wasAtBottomRef.current = true;
      }
    });

    resizeObserver.observe(content);
    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', handleScroll);
    };
  }, [isAtBottom]);

  /**
   * When streaming ends, correct scroll position synchronously before paint.
   *
   * useLayoutEffect fires after React commits DOM mutations (ThinkingAnimation
   * unmount, action buttons appearing) but BEFORE the browser paints. Reading
   * scrollHeight forces a synchronous layout, and the scrollTo applies the
   * correction in the same frame — the user never sees an intermediate state.
   */
  useLayoutEffect(() => {
    if (enabled) {
      wasEnabledRef.current = true;
    } else if (wasEnabledRef.current && wasAtBottomRef.current) {
      wasEnabledRef.current = false;
      const container = containerRef.current;
      if (container) {
        programmaticScrollAtRef.current = performance.now();
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'instant',
        });
      }
    }
  }, [enabled]);

  return {
    containerRef,
    contentRef,
    scrollToBottom,
    scrollTo,
    isAtBottom,
  };
}
