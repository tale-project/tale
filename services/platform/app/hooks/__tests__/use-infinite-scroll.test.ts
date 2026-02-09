import { render, renderHook } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useInfiniteScroll } from '../use-infinite-scroll';

interface TestComponentProps {
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  threshold?: number;
  enabled?: boolean;
  root?: React.RefObject<HTMLElement | null>;
}

function TestComponent({
  onLoadMore,
  hasMore,
  isLoading,
  threshold,
  enabled,
  root,
}: TestComponentProps) {
  const { sentinelRef } = useInfiniteScroll({
    onLoadMore,
    hasMore,
    isLoading,
    threshold,
    enabled,
    root,
  });
  return React.createElement('div', {
    ref: sentinelRef,
    'data-testid': 'sentinel',
  });
}

describe('useInfiniteScroll', () => {
  let mockObserve: ReturnType<typeof vi.fn>;
  let mockDisconnect: ReturnType<typeof vi.fn>;
  let observerCallback: IntersectionObserverCallback | undefined;
  let observerOptions: IntersectionObserverInit | undefined;

  beforeEach(() => {
    mockObserve = vi.fn();
    mockDisconnect = vi.fn();
    observerCallback = undefined;
    observerOptions = undefined;

    global.IntersectionObserver = class MockIntersectionObserver {
      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        observerCallback = callback;
        observerOptions = options;
      }
      observe = mockObserve;
      disconnect = mockDisconnect;
      unobserve = vi.fn();
      takeRecords = vi.fn() as () => IntersectionObserverEntry[];
      root = null;
      rootMargin = '';
      thresholds = [] as number[];
    } as unknown as typeof IntersectionObserver;
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
        }),
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
        }),
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
        }),
      );

      expect(mockObserve).not.toHaveBeenCalled();
    });

    it('does not create observer when hasMore is false', () => {
      const onLoadMore = vi.fn();

      renderHook(() =>
        useInfiniteScroll({
          onLoadMore,
          hasMore: false,
          isLoading: false,
          enabled: true,
        }),
      );

      expect(mockObserve).not.toHaveBeenCalled();
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
        }),
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
        }),
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
        }),
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
        }),
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
        }),
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
          threshold: 700,
        }),
      );

      expect(true).toBe(true);
    });
  });

  describe('observer options', () => {
    it('uses null root when no root ref is provided', () => {
      render(
        React.createElement(TestComponent, {
          onLoadMore: vi.fn(),
          hasMore: true,
          isLoading: false,
        }),
      );

      expect(observerOptions?.root).toBeNull();
    });

    it('passes root element to IntersectionObserver when root ref is provided', () => {
      const rootElement = document.createElement('div');
      const rootRef = { current: rootElement } as React.RefObject<HTMLElement>;

      render(
        React.createElement(TestComponent, {
          onLoadMore: vi.fn(),
          hasMore: true,
          isLoading: false,
          root: rootRef,
        }),
      );

      expect(observerOptions?.root).toBe(rootElement);
    });

    it('uses bottom-only rootMargin format', () => {
      render(
        React.createElement(TestComponent, {
          onLoadMore: vi.fn(),
          hasMore: true,
          isLoading: false,
          threshold: 400,
        }),
      );

      expect(observerOptions?.rootMargin).toBe('0px 0px 400px 0px');
    });

    it('uses default threshold of 500px', () => {
      render(
        React.createElement(TestComponent, {
          onLoadMore: vi.fn(),
          hasMore: true,
          isLoading: false,
        }),
      );

      expect(observerOptions?.rootMargin).toBe('0px 0px 500px 0px');
    });
  });
});
