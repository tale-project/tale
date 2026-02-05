'use client';

import { useEffect, useRef } from 'react';

interface UseInfiniteScrollOptions {
  /**
   * Callback to fetch more data.
   *
   * IMPORTANT: This callback should be memoized (wrapped in useCallback) to prevent
   * the IntersectionObserver from being recreated on every render.
   */
  onLoadMore: () => void;
  /**
   * Whether there are more items to load
   */
  hasMore: boolean;
  /**
   * Whether data is currently being loaded
   */
  isLoading: boolean;
  /**
   * Distance from bottom in pixels to trigger loading (default: 300px)
   * Positive value means trigger BEFORE reaching the sentinel
   */
  threshold?: number;
  /**
   * Whether the hook is enabled (default: true)
   */
  enabled?: boolean;
}

interface UseInfiniteScrollReturn {
  /**
   * Ref to attach to the sentinel element at the bottom of the scrollable content
   */
  sentinelRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * useInfiniteScroll - Automatic infinite scrolling using IntersectionObserver
 *
 * This hook watches a sentinel element and triggers loading when it becomes visible.
 * Uses IntersectionObserver for optimal performance (no scroll event listeners).
 *
 * Key behaviors:
 * - Triggers onLoadMore when sentinel enters viewport
 * - Respects isLoading to prevent duplicate requests
 * - Respects hasMore to avoid loading when exhausted
 * - Uses rootMargin for preemptive loading (smooth UX)
 * - Properly cleans up observer on unmount
 *
 * IMPORTANT: The onLoadMore callback should be memoized with useCallback to prevent
 * unnecessary IntersectionObserver recreations on every render.
 *
 * @example
 * ```tsx
 * const handleLoadMore = useCallback(() => loadMore(25), [loadMore]);
 *
 * const { sentinelRef } = useInfiniteScroll({
 *   onLoadMore: handleLoadMore,
 *   hasMore: status === 'CanLoadMore',
 *   isLoading: status === 'LoadingMore',
 *   threshold: 300,
 * });
 *
 * return (
 *   <div>
 *     {items.map(item => <Item key={item.id} {...item} />)}
 *     <div ref={sentinelRef} />
 *   </div>
 * );
 * ```
 */
export function useInfiniteScroll({
  onLoadMore,
  hasMore,
  isLoading,
  threshold = 300,
  enabled = true,
}: UseInfiniteScrollOptions): UseInfiniteScrollReturn {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !enabled || !hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && !isLoading && hasMore) {
          onLoadMore();
        }
      },
      {
        rootMargin: `${threshold}px`,
        threshold: 0,
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [enabled, hasMore, isLoading, onLoadMore, threshold]);

  return {
    sentinelRef,
  };
}
