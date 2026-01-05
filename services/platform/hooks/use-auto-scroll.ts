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
   * Manually scroll to bottom and re-enable auto-scroll
   */
  scrollToBottom: () => void;
  /**
   * Whether user is currently at bottom (for showing scroll button)
   */
  isAtBottom: () => boolean;
}

/**
 * useAutoScroll - Intelligent auto-scrolling during streaming content
 *
 * Solves the scroll jumping problem by:
 * 1. Disabling browser scroll anchoring (via CSS overflow-anchor: none)
 * 2. Using ResizeObserver to detect content growth
 * 3. Only scrolling if user is at/near bottom (respects user intent)
 * 4. Re-enabling auto-scroll when user returns to bottom
 *
 * Key behaviors:
 * - If user is at bottom and content grows → scroll to follow
 * - If user scrolls up → stop auto-scrolling, let them read
 * - If user scrolls back to bottom → resume auto-scrolling
 * - Scroll-to-bottom button re-enables auto-scroll
 */
export function useAutoScroll({
  enabled,
  threshold = 100,
}: UseAutoScrollOptions): UseAutoScrollReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Track the last scroll position to detect user scroll direction
  const lastScrollTopRef = useRef(0);
  // Track if we're in the middle of a programmatic scroll
  const isProgrammaticScrollRef = useRef(false);
  // Track if auto-scroll is currently enabled (user hasn't scrolled away)
  const autoScrollEnabledRef = useRef(true);

  /**
   * Check if the container is scrolled to the bottom (within threshold)
   */
  const isAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;

    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight <= threshold;
  }, [threshold]);

  /**
   * Scroll to bottom of the container
   */
  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    isProgrammaticScrollRef.current = true;
    autoScrollEnabledRef.current = true;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });

    // Reset flag after scroll completes
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    });
  }, []);

  /**
   * Handle user scroll events to detect manual scrolling
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Ignore our own programmatic scrolls
      if (isProgrammaticScrollRef.current) return;

      const currentScrollTop = container.scrollTop;
      const scrolledUp = currentScrollTop < lastScrollTopRef.current;

      if (scrolledUp) {
        // User scrolled up - disable auto-scroll
        autoScrollEnabledRef.current = false;
      } else if (isAtBottom()) {
        // User scrolled to bottom - re-enable auto-scroll
        autoScrollEnabledRef.current = true;
      }

      lastScrollTopRef.current = currentScrollTop;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [isAtBottom]);

  /**
   * ResizeObserver to detect content growth and trigger auto-scroll
   */
  useEffect(() => {
    const content = contentRef.current;
    const container = containerRef.current;
    if (!content || !container || !enabled) return;

    const resizeObserver = new ResizeObserver(() => {
      // Only auto-scroll if enabled and user is at bottom
      if (autoScrollEnabledRef.current && isAtBottom()) {
        isProgrammaticScrollRef.current = true;

        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'instant', // Use instant for continuous scrolling during streaming
        });

        requestAnimationFrame(() => {
          isProgrammaticScrollRef.current = false;
        });
      }
    });

    resizeObserver.observe(content);

    return () => {
      resizeObserver.disconnect();
    };
  }, [enabled, isAtBottom]);

  /**
   * Reset auto-scroll state when streaming starts
   */
  useEffect(() => {
    if (enabled) {
      autoScrollEnabledRef.current = true;
    }
  }, [enabled]);

  return {
    containerRef,
    contentRef,
    scrollToBottom,
    isAtBottom,
  };
}
