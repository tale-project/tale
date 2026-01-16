'use client';

import { useCallback, useRef } from 'react';

interface UseThrottledScrollOptions {
  delay?: number; // Throttle delay in milliseconds
}

export function useThrottledScroll({
  delay = 16,
}: UseThrottledScrollOptions = {}) {
  const lastScrollTime = useRef<number>(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const throttledScrollToBottom = useCallback(
    (element: HTMLElement, behavior: ScrollBehavior = 'smooth') => {
      const now = Date.now();
      const timeSinceLastScroll = now - lastScrollTime.current;

      // Clear any pending scroll
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      const performScroll = () => {
        element.scrollTo({
          top: element.scrollHeight,
          behavior,
        });
        lastScrollTime.current = Date.now();
      };

      if (timeSinceLastScroll >= delay) {
        // Execute immediately if enough time has passed
        performScroll();
      } else {
        // Schedule for later
        scrollTimeoutRef.current = setTimeout(
          performScroll,
          delay - timeSinceLastScroll,
        );
      }
    },
    [delay],
  );

  const cleanup = useCallback(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
  }, []);

  return {
    throttledScrollToBottom,
    cleanup,
  };
}
