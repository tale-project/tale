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
 * useAutoScroll - Position-based auto-scrolling for growing content.
 *
 * Core invariant: "If the user is at the bottom and content grows, follow it."
 *
 * The ResizeObserver and scroll handler run continuously — position is the sole
 * source of truth, not streaming state. The `enabled` flag only controls whether
 * shrinkage is also followed (useful during streaming when markdown restructuring
 * can temporarily reduce height).
 *
 * A programmatic scroll guard distinguishes our own scrollTo calls from user
 * scrolls, preventing async scroll events from falsely updating the position
 * state. Works correctly with ALL scroll methods (mouse wheel, trackpad,
 * scrollbar drag, keyboard, programmatic scroll).
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

  // Guard: marks the next scroll event as originating from our own scrollTo
  // call, preventing it from overriding wasAtBottomRef via the isAtBottom()
  // geometry check. Without this, the async scroll event from a programmatic
  // scrollTo can arrive after content has grown, causing isAtBottom() to
  // return false and permanently breaking auto-scroll.
  const programmaticScrollRef = useRef(false);

  // Track content height for growth vs. shrinkage detection.
  const lastContentHeightRef = useRef(0);
  // Track enabled transitions for end-of-streaming scroll.
  const wasEnabledRef = useRef(false);
  // Ref mirror of `enabled` — read inside ResizeObserver without stale closures.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

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
    programmaticScrollRef.current = true;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'instant',
    });
  }, []);

  /**
   * Scroll tracking + ResizeObserver — runs continuously.
   *
   * The scroll handler keeps wasAtBottomRef in sync with the user's position.
   * The ResizeObserver reads wasAtBottomRef (set BEFORE growth) to decide
   * whether to follow content growth — avoiding the isAtBottom()-after-growth
   * trap that would break auto-scroll on large DOM changes (>threshold).
   *
   * Growth is always followed when the user is at the bottom (streaming,
   * typewriter drain, new messages). Shrinkage is only followed when
   * `enabled` is true (during streaming, where markdown restructuring
   * can temporarily reduce height).
   */
  useEffect(() => {
    const content = contentRef.current;
    const container = containerRef.current;
    if (!content || !container) return;

    wasAtBottomRef.current = isAtBottom();

    const handleScroll = () => {
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        wasAtBottomRef.current = true;
        return;
      }
      wasAtBottomRef.current = isAtBottom();
    };

    const resizeObserver = new ResizeObserver((entries) => {
      const newHeight = entries[0]?.contentRect?.height ?? 0;
      const grew = newHeight > lastContentHeightRef.current;
      const changed = newHeight !== lastContentHeightRef.current;
      lastContentHeightRef.current = newHeight;

      // Always follow growth when user is at bottom (streaming, typewriter
      // drain, new messages). Only follow shrinkage during streaming (handles
      // markdown restructuring, code block transitions).
      if (changed && (grew || enabledRef.current) && wasAtBottomRef.current) {
        programmaticScrollRef.current = true;
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
  }, [isAtBottom]);

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
