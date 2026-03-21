'use client';

import { useCallback, useRef } from 'react';

interface UseAutoScrollOptions {
  /**
   * Threshold in pixels from bottom to consider "at bottom".
   * User is considered "at bottom" if within this distance.
   */
  threshold?: number;
}

interface UseAutoScrollReturn {
  /** Ref to attach to the scrollable container */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Ref to attach to the content container (for ResizeObserver in consumer) */
  contentRef: React.RefObject<HTMLDivElement | null>;
  /** One-shot scroll to bottom */
  scrollToBottom: () => void;
  /** One-shot scroll to a specific position */
  scrollTo: (top: number) => void;
  /** Whether user is currently at bottom (for showing scroll button) */
  isAtBottom: () => boolean;
}

/**
 * useAutoScroll - Scroll utility for chat containers.
 *
 * Provides refs, scroll helpers, and an isAtBottom check.
 * Does NOT auto-follow content growth — the consumer decides
 * when and where to scroll (ChatGPT-style: only on user send).
 */
export function useAutoScroll({
  threshold = 100,
}: UseAutoScrollOptions = {}): UseAutoScrollReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const isAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;

    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight <= threshold;
  }, [threshold]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
  }, []);

  const scrollTo = useCallback((top: number) => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top, behavior: 'instant' });
  }, []);

  return {
    containerRef,
    contentRef,
    scrollToBottom,
    scrollTo,
    isAtBottom,
  };
}
