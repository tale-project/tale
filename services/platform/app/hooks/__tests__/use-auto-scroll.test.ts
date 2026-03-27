import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { useAutoScroll } from '../use-auto-scroll';

function createMockContainer() {
  const el = document.createElement('div');
  let _scrollTop = 0;

  Object.defineProperties(el, {
    scrollTop: {
      get: () => _scrollTop,
      set: (v: number) => {
        _scrollTop = v;
      },
      configurable: true,
    },
    scrollHeight: { value: 1000, writable: true, configurable: true },
    clientHeight: { value: 400, writable: true, configurable: true },
  });

  const scrollToSpy = vi.fn((opts?: ScrollToOptions) => {
    if (opts)
      _scrollTop = Math.min(opts.top ?? 0, el.scrollHeight - el.clientHeight);
  });
  el.scrollTo = scrollToSpy as typeof el.scrollTo;

  function setScrollGeometry(scrollHeight: number, clientHeight: number) {
    Object.defineProperty(el, 'scrollHeight', {
      value: scrollHeight,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(el, 'clientHeight', {
      value: clientHeight,
      writable: true,
      configurable: true,
    });
  }

  return {
    el,
    scrollToSpy,
    setScrollGeometry,
    get scrollTop() {
      return _scrollTop;
    },
    set scrollTop(v: number) {
      _scrollTop = v;
    },
  };
}

describe('useAutoScroll', () => {
  describe('isAtBottom', () => {
    it('returns true when at the bottom within threshold', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);
      container.scrollTop = 550; // distance = 1000 - 550 - 400 = 50 < 100

      const { result } = renderHook(() => useAutoScroll({ threshold: 100 }));

      Object.defineProperty(result.current.containerRef, 'current', {
        value: container.el,
        writable: true,
      });

      expect(result.current.isAtBottom()).toBe(true);
    });

    it('returns false when scrolled away from bottom', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);
      container.scrollTop = 200; // distance = 1000 - 200 - 400 = 400 > 100

      const { result } = renderHook(() => useAutoScroll({ threshold: 100 }));

      Object.defineProperty(result.current.containerRef, 'current', {
        value: container.el,
        writable: true,
      });

      expect(result.current.isAtBottom()).toBe(false);
    });

    it('returns true when no container is attached', () => {
      const { result } = renderHook(() => useAutoScroll());

      expect(result.current.isAtBottom()).toBe(true);
    });
  });

  describe('scrollToBottom', () => {
    it('scrolls to bottom with instant behavior', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);

      const { result } = renderHook(() => useAutoScroll());

      Object.defineProperty(result.current.containerRef, 'current', {
        value: container.el,
        writable: true,
      });

      act(() => {
        result.current.scrollToBottom();
      });

      expect(container.scrollToSpy).toHaveBeenCalledWith({
        top: 1000,
        behavior: 'instant',
      });
    });

    it('is a one-shot scroll with no auto-follow', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);

      const { result } = renderHook(() => useAutoScroll());

      Object.defineProperty(result.current.containerRef, 'current', {
        value: container.el,
        writable: true,
      });

      act(() => {
        result.current.scrollToBottom();
      });

      container.scrollToSpy.mockClear();

      // Simulate content growth — no auto-scroll should happen
      container.setScrollGeometry(1200, 400);
      // No ResizeObserver in the hook, so nothing fires
      expect(container.scrollToSpy).not.toHaveBeenCalled();
    });
  });

  describe('scrollTo', () => {
    it('scrolls to a specific position with instant behavior', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);

      const { result } = renderHook(() => useAutoScroll());

      Object.defineProperty(result.current.containerRef, 'current', {
        value: container.el,
        writable: true,
      });

      act(() => {
        result.current.scrollTo(200);
      });

      expect(container.scrollToSpy).toHaveBeenCalledWith({
        top: 200,
        behavior: 'instant',
      });
    });

    it('is a one-shot scroll with no auto-follow', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);

      const { result } = renderHook(() => useAutoScroll());

      Object.defineProperty(result.current.containerRef, 'current', {
        value: container.el,
        writable: true,
      });

      act(() => {
        result.current.scrollTo(200);
      });

      container.scrollToSpy.mockClear();

      // Content growth — no auto-follow
      container.setScrollGeometry(1200, 400);
      expect(container.scrollToSpy).not.toHaveBeenCalled();
    });
  });

  describe('refs', () => {
    it('provides stable containerRef and contentRef', () => {
      const { result, rerender } = renderHook(() => useAutoScroll());

      const containerRef1 = result.current.containerRef;
      const contentRef1 = result.current.contentRef;

      rerender();

      expect(result.current.containerRef).toBe(containerRef1);
      expect(result.current.contentRef).toBe(contentRef1);
    });
  });
});
