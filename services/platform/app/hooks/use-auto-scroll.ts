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
 * Check if any scrollable ancestor between target and boundary can absorb
 * an upward scroll (i.e., is vertically scrollable and has scrollTop > 0).
 * This prevents wheel/touch events inside nested scrollable containers
 * (e.g. code blocks with overflow-auto + max-h) from falsely disabling
 * auto-scroll on the main container.
 */
function canNestedContainerScrollUp(
  target: EventTarget | null,
  boundary: HTMLElement,
) {
  let el = target instanceof HTMLElement ? target : null;
  while (el && el !== boundary) {
    if (el.scrollHeight > el.clientHeight && el.scrollTop > 0) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * useAutoScroll - Intelligent auto-scrolling during streaming content
 *
 * Detects user scroll intent via direct input events (wheel, touch) rather
 * than inferring from scrollTop changes. This avoids false positives from
 * browser scroll clamping, programmatic scrolls, and nested scrollable
 * containers (e.g. code blocks).
 *
 * Key behaviors:
 * - If user is at bottom and content grows → scroll to follow
 * - If user scrolls up (wheel/touch) → stop auto-scrolling, let them read
 * - If user scrolls back to bottom → resume auto-scrolling
 * - Scroll-to-bottom button re-enables auto-scroll
 */
export function useAutoScroll({
  enabled,
  threshold = 100,
}: UseAutoScrollOptions): UseAutoScrollReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

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

    autoScrollEnabledRef.current = true;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }, []);

  /**
   * Detect user scroll-away intent via direct input events.
   *
   * wheel/touch events only fire from real user input — never from
   * programmatic scrollTo() or browser scroll clamping — eliminating the
   * false-positive problems that scrollTop comparison had.
   *
   * Re-enabling is handled by the scroll event: when the user returns to
   * the bottom (via any method), auto-scroll resumes.
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && !canNestedContainerScrollUp(e.target, container)) {
        autoScrollEnabledRef.current = false;
      }
    };

    let lastTouchY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY ?? 0;
    };
    const handleTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0]?.clientY ?? 0;
      if (
        currentY > lastTouchY &&
        !canNestedContainerScrollUp(e.target, container)
      ) {
        autoScrollEnabledRef.current = false;
      }
      lastTouchY = currentY;
    };

    const handleScroll = () => {
      if (!autoScrollEnabledRef.current && isAtBottom()) {
        autoScrollEnabledRef.current = true;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: true });
    container.addEventListener('touchstart', handleTouchStart, {
      passive: true,
    });
    container.addEventListener('touchmove', handleTouchMove, {
      passive: true,
    });
    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('scroll', handleScroll);
    };
  }, [isAtBottom]);

  // Track content height to distinguish growth from shrinkage.
  // Initialized to 0 so the first ResizeObserver callback always counts as
  // growth, triggering an immediate scroll-to-bottom when streaming starts.
  const lastContentHeightRef = useRef(0);
  // Track previous enabled state for transition detection
  const wasEnabledRef = useRef(false);

  /**
   * ResizeObserver to detect content growth and trigger auto-scroll.
   *
   * Only checks autoScrollEnabledRef (user intent), NOT isAtBottom().
   * Reason: isAtBottom() is measured AFTER the DOM grows, so a single
   * large growth (>threshold) would make it return false and permanently
   * break auto-scroll until the user manually scrolls down.
   *
   * Also only scrolls on content growth, not shrinkage, to avoid
   * unnecessary scroll adjustments when elements are removed (e.g. cursor).
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

    const resizeObserver = new ResizeObserver((entries) => {
      const newHeight = entries[0]?.contentRect?.height ?? 0;
      const grew = newHeight > lastContentHeightRef.current;
      lastContentHeightRef.current = newHeight;

      if (grew && autoScrollEnabledRef.current) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'instant',
        });
      }
    });

    resizeObserver.observe(content);

    return () => {
      resizeObserver.disconnect();
    };
  }, [enabled]);

  /**
   * Reset auto-scroll state when streaming starts.
   * When streaming ends, do one deferred scroll to catch final DOM changes
   * (e.g. copy/info buttons appearing after ResizeObserver disconnects).
   */
  useEffect(() => {
    if (enabled) {
      autoScrollEnabledRef.current = true;
      wasEnabledRef.current = true;
    } else if (wasEnabledRef.current && autoScrollEnabledRef.current) {
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
