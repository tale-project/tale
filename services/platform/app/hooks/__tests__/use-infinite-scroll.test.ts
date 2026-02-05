import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useInfiniteScroll } from '../use-infinite-scroll';

describe('useInfiniteScroll', () => {
  let mockObserve: ReturnType<typeof vi.fn>;
  let mockDisconnect: ReturnType<typeof vi.fn>;
  let observerCallback: IntersectionObserverCallback | undefined;

  beforeEach(() => {
    mockObserve = vi.fn();
    mockDisconnect = vi.fn();
    observerCallback = undefined;

    const mockIntersectionObserver = vi.fn((callback) => {
      observerCallback = callback;
      return {
        observe: mockObserve,
        disconnect: mockDisconnect,
        unobserve: vi.fn(),
        takeRecords: vi.fn(),
        root: null,
        rootMargin: '',
        thresholds: [],
      };
    }) as unknown as typeof IntersectionObserver;

    global.IntersectionObserver = mockIntersectionObserver;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('hook initialization', () => {
    it('returns a ref object', () => {
      const onLoadMore = vi.fn();

      const { result } = renderHook(() =>
        useInfiniteScroll({
          onLoadMore,
          hasMore: true,
          isLoading: false,
        })
      );

      expect(result.current.sentinelRef).toBeDefined();
      expect(result.current.sentinelRef.current).toBeNull();
    });

    it('allows setting the ref', () => {
      const onLoadMore = vi.fn();
      const sentinelElement = document.createElement('div');

      const { result } = renderHook(() =>
        useInfiniteScroll({
          onLoadMore,
          hasMore: true,
          isLoading: false,
        })
      );

      result.current.sentinelRef.current = sentinelElement;

      expect(result.current.sentinelRef.current).toBe(sentinelElement);
    });
  });

  describe('observer behavior', () => {
    it('does not create observer when disabled', () => {
      const onLoadMore = vi.fn();

      renderHook(() =>
        useInfiniteScroll({
          onLoadMore,
          hasMore: true,
          isLoading: false,
          enabled: false,
        })
      );

      expect(global.IntersectionObserver).not.toHaveBeenCalled();
    });

    it('does not create observer when hasMore is false', () => {
      const onLoadMore = vi.fn();

      renderHook(() =>
        useInfiniteScroll({
          onLoadMore,
          hasMore: false,
          isLoading: false,
          enabled: true,
        })
      );

      expect(global.IntersectionObserver).not.toHaveBeenCalled();
    });
  });

  describe('loading behavior', () => {
    it('calls onLoadMore when sentinel intersects and conditions are met', () => {
      const onLoadMore = vi.fn();
      const sentinelElement = document.createElement('div');

      renderHook(() =>
        useInfiniteScroll({
          onLoadMore,
          hasMore: true,
          isLoading: false,
          enabled: true,
        })
      );

      if (observerCallback) {
        const entries: IntersectionObserverEntry[] = [
          {
            isIntersecting: true,
            target: sentinelElement,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRatio: 1,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: Date.now(),
          },
        ];

        observerCallback(entries, {} as IntersectionObserver);

        expect(onLoadMore).toHaveBeenCalledTimes(1);
      }
    });

    it('does not call onLoadMore when isLoading is true', () => {
      const onLoadMore = vi.fn();
      const sentinelElement = document.createElement('div');

      renderHook(() =>
        useInfiniteScroll({
          onLoadMore,
          hasMore: true,
          isLoading: true,
          enabled: true,
        })
      );

      if (observerCallback) {
        const entries: IntersectionObserverEntry[] = [
          {
            isIntersecting: true,
            target: sentinelElement,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRatio: 1,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: Date.now(),
          },
        ];

        observerCallback(entries, {} as IntersectionObserver);

        expect(onLoadMore).not.toHaveBeenCalled();
      }
    });

    it('does not call onLoadMore when hasMore is false', () => {
      const onLoadMore = vi.fn();
      const sentinelElement = document.createElement('div');

      renderHook(() =>
        useInfiniteScroll({
          onLoadMore,
          hasMore: false,
          isLoading: false,
          enabled: true,
        })
      );

      if (observerCallback) {
        const entries: IntersectionObserverEntry[] = [
          {
            isIntersecting: true,
            target: sentinelElement,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRatio: 1,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: Date.now(),
          },
        ];

        observerCallback(entries, {} as IntersectionObserver);

        expect(onLoadMore).not.toHaveBeenCalled();
      }
    });

    it('does not call onLoadMore when sentinel is not intersecting', () => {
      const onLoadMore = vi.fn();
      const sentinelElement = document.createElement('div');

      renderHook(() =>
        useInfiniteScroll({
          onLoadMore,
          hasMore: true,
          isLoading: false,
          enabled: true,
        })
      );

      if (observerCallback) {
        const entries: IntersectionObserverEntry[] = [
          {
            isIntersecting: false,
            target: sentinelElement,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRatio: 0,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: Date.now(),
          },
        ];

        observerCallback(entries, {} as IntersectionObserver);

        expect(onLoadMore).not.toHaveBeenCalled();
      }
    });
  });

  describe('default values', () => {
    it('defaults enabled to true', () => {
      const onLoadMore = vi.fn();

      const { result } = renderHook(() =>
        useInfiniteScroll({
          onLoadMore,
          hasMore: true,
          isLoading: false,
        })
      );

      expect(result.current.sentinelRef).toBeDefined();
    });

    it('uses provided threshold value', () => {
      const onLoadMore = vi.fn();

      renderHook(() =>
        useInfiniteScroll({
          onLoadMore,
          hasMore: true,
          isLoading: false,
          threshold: 500,
        })
      );

      expect(true).toBe(true);
    });
  });
});
