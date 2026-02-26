import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useAutoScroll } from '../use-auto-scroll';

// Minimal mock container with controllable scroll geometry
function createMockContainer() {
  const el = document.createElement('div');
  let _scrollTop = 0;
  const scrollListeners: EventListener[] = [];

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

  const origAdd = el.addEventListener.bind(el);
  const origRemove = el.removeEventListener.bind(el);

  const addEventListenerSpy = vi.fn(
    (
      type: string,
      handler: EventListener,
      opts?: AddEventListenerOptions | boolean,
    ) => {
      if (type === 'scroll') scrollListeners.push(handler);
      origAdd(type, handler, opts);
    },
  );
  el.addEventListener = addEventListenerSpy;

  const removeEventListenerSpy = vi.fn(
    (
      type: string,
      handler: EventListener,
      opts?: EventListenerOptions | boolean,
    ) => {
      const idx = scrollListeners.indexOf(handler);
      if (idx >= 0) scrollListeners.splice(idx, 1);
      origRemove(type, handler, opts);
    },
  );
  el.removeEventListener = removeEventListenerSpy;

  const scrollToSpy = vi.fn((opts?: ScrollToOptions) => {
    if (opts)
      _scrollTop = Math.min(opts.top ?? 0, el.scrollHeight - el.clientHeight);
    fireScrollEvent();
  });
  // scrollTo has two overloads; we only use the options form in the hook
  el.scrollTo = scrollToSpy as typeof el.scrollTo;

  function fireScrollEvent() {
    for (const fn of scrollListeners) {
      fn(new Event('scroll'));
    }
  }

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
    removeEventListenerSpy,
    fireScrollEvent,
    setScrollGeometry,
    get scrollTop() {
      return _scrollTop;
    },
    set scrollTop(v: number) {
      _scrollTop = v;
    },
  };
}

let resizeObserverCallback: ResizeObserverCallback | undefined;
let resizeObserverDisconnect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resizeObserverCallback = undefined;
  resizeObserverDisconnect = vi.fn();

  global.ResizeObserver = class MockResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeObserverCallback = callback;
    }
    observe = vi.fn();
    disconnect = resizeObserverDisconnect;
    unobserve = vi.fn();
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function simulateContentGrowth(height: number) {
  if (!resizeObserverCallback) throw new Error('ResizeObserver not created');
  resizeObserverCallback(
    [{ contentRect: { height } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
}

// Helper: render the hook with refs pre-attached so effects see them.
// Refs are set during the render phase (before effects run) so the
// always-on ResizeObserver is created on mount.
function setupStreamingHook(
  container: ReturnType<typeof createMockContainer>,
  opts: { threshold?: number } = {},
) {
  const content = document.createElement('div');
  const threshold = opts.threshold ?? 100;
  let refsAttached = false;

  const harness = renderHook(
    ({ enabled }) => {
      const result = useAutoScroll({ enabled, threshold });
      // Attach refs during render so the effect sees them on mount.
      if (!refsAttached) {
        refsAttached = true;
        Object.defineProperty(result.containerRef, 'current', {
          value: container.el,
          writable: true,
        });
        Object.defineProperty(result.contentRef, 'current', {
          value: content,
          writable: true,
        });
      }
      return result;
    },
    { initialProps: { enabled: false } },
  );

  return harness;
}

describe('useAutoScroll', () => {
  describe('isAtBottom', () => {
    it('returns true when at the bottom within threshold', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);
      container.scrollTop = 550; // distance = 1000 - 550 - 400 = 50 < 100

      const { result } = renderHook(() =>
        useAutoScroll({ enabled: false, threshold: 100 }),
      );

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

      const { result } = renderHook(() =>
        useAutoScroll({ enabled: false, threshold: 100 }),
      );

      Object.defineProperty(result.current.containerRef, 'current', {
        value: container.el,
        writable: true,
      });

      expect(result.current.isAtBottom()).toBe(false);
    });

    it('returns true when no container is attached', () => {
      const { result } = renderHook(() => useAutoScroll({ enabled: false }));

      expect(result.current.isAtBottom()).toBe(true);
    });
  });

  describe('auto-scroll on content growth', () => {
    it('scrolls to bottom when content grows and user was at bottom', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);
      container.scrollTop = 600; // at bottom

      const { rerender } = setupStreamingHook(container);

      rerender({ enabled: true });

      container.setScrollGeometry(1200, 400);
      simulateContentGrowth(800);

      expect(container.scrollToSpy).toHaveBeenCalledWith({
        top: 1200,
        behavior: 'instant',
      });
    });

    it('does NOT scroll when content grows and user was NOT at bottom', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);
      container.scrollTop = 100; // distance = 500 > 100

      const { rerender } = setupStreamingHook(container);

      rerender({ enabled: true });
      container.scrollToSpy.mockClear();

      container.setScrollGeometry(1200, 400);
      simulateContentGrowth(800);

      expect(container.scrollToSpy).not.toHaveBeenCalled();
    });

    it('scrolls on content shrinkage when at bottom (keeps user anchored)', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);
      container.scrollTop = 600; // at bottom

      const { rerender } = setupStreamingHook(container);

      rerender({ enabled: true });

      // First growth
      simulateContentGrowth(600);
      container.scrollToSpy.mockClear();

      // Shrinkage — during streaming, user should stay at bottom
      simulateContentGrowth(500);
      expect(container.scrollToSpy).toHaveBeenCalledWith({
        top: 1000,
        behavior: 'instant',
      });
    });
  });

  describe('user scroll-away and recovery', () => {
    it('stops auto-scrolling when user scrolls away, resumes when they return', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);
      container.scrollTop = 600; // at bottom

      const { rerender } = setupStreamingHook(container);

      rerender({ enabled: true });

      // Initial growth — should auto-scroll
      container.setScrollGeometry(1100, 400);
      simulateContentGrowth(700);
      expect(container.scrollToSpy).toHaveBeenLastCalledWith({
        top: 1100,
        behavior: 'instant',
      });

      // User scrolls away (any method — scrollbar, wheel, keyboard)
      act(() => {
        container.scrollTop = 200; // far from bottom
        container.fireScrollEvent();
      });

      container.scrollToSpy.mockClear();

      // More content growth — should NOT auto-scroll
      container.setScrollGeometry(1200, 400);
      simulateContentGrowth(800);
      expect(container.scrollToSpy).not.toHaveBeenCalled();

      // User scrolls back to bottom
      act(() => {
        container.scrollTop = 800; // at bottom (1200 - 800 - 400 = 0)
        container.fireScrollEvent();
      });

      // More content growth — should auto-scroll again
      container.setScrollGeometry(1300, 400);
      simulateContentGrowth(900);
      expect(container.scrollToSpy).toHaveBeenCalledWith({
        top: 1300,
        behavior: 'instant',
      });
    });

    it('handles scrollbar drag correctly (no wheel/touch events needed)', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);
      container.scrollTop = 600; // at bottom

      const { rerender } = setupStreamingHook(container);

      rerender({ enabled: true });

      // Simulate scrollbar drag up — only fires scroll event, no wheel
      act(() => {
        container.scrollTop = 50;
        container.fireScrollEvent();
      });

      container.scrollToSpy.mockClear();

      // Content growth should NOT auto-scroll
      container.setScrollGeometry(1100, 400);
      simulateContentGrowth(700);
      expect(container.scrollToSpy).not.toHaveBeenCalled();
    });
  });

  describe('scrollToBottom', () => {
    it('scrolls to bottom with instant behavior', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);

      const { result } = renderHook(() => useAutoScroll({ enabled: false }));

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

    it('resumes auto-scroll during streaming after user scrolled away', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);
      container.scrollTop = 600; // at bottom

      const { result, rerender } = setupStreamingHook(container);

      rerender({ enabled: true });

      // User scrolls away
      act(() => {
        container.scrollTop = 100;
        container.fireScrollEvent();
      });

      container.scrollToSpy.mockClear();

      // Content growth should NOT auto-scroll (user is away)
      container.setScrollGeometry(1100, 400);
      simulateContentGrowth(700);
      expect(container.scrollToSpy).not.toHaveBeenCalled();

      // User clicks scroll-to-bottom button
      act(() => {
        result.current.scrollToBottom();
      });

      container.scrollToSpy.mockClear();

      // Content growth should now auto-scroll again
      container.setScrollGeometry(1200, 400);
      simulateContentGrowth(800);
      expect(container.scrollToSpy).toHaveBeenCalledWith({
        top: 1200,
        behavior: 'instant',
      });
    });
  });

  describe('end-of-streaming scroll', () => {
    it('does a final scroll when streaming ends and user was at bottom', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);
      container.scrollTop = 600; // at bottom

      const rafSpy = vi
        .spyOn(window, 'requestAnimationFrame')
        .mockImplementation((cb) => {
          cb(0);
          return 0;
        });

      const { rerender } = setupStreamingHook(container);

      rerender({ enabled: true });
      container.scrollToSpy.mockClear();

      rerender({ enabled: false });

      expect(container.scrollToSpy).toHaveBeenCalledWith({
        top: 1000,
        behavior: 'instant',
      });

      rafSpy.mockRestore();
    });

    it('does NOT do final scroll when user scrolled away during streaming', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);
      container.scrollTop = 600; // at bottom

      const rafSpy = vi
        .spyOn(window, 'requestAnimationFrame')
        .mockImplementation((cb) => {
          cb(0);
          return 0;
        });

      const { rerender } = setupStreamingHook(container);

      rerender({ enabled: true });

      // User scrolls away during streaming
      act(() => {
        container.scrollTop = 100;
        container.fireScrollEvent();
      });

      container.scrollToSpy.mockClear();

      rerender({ enabled: false });

      expect(container.scrollToSpy).not.toHaveBeenCalled();

      rafSpy.mockRestore();
    });
  });

  describe('ResizeObserver lifecycle', () => {
    it('creates observer on mount regardless of enabled state', () => {
      const container = createMockContainer();

      setupStreamingHook(container);

      // Observer is created on mount even with enabled=false
      expect(resizeObserverCallback).toBeDefined();
      expect(resizeObserverDisconnect).not.toHaveBeenCalled();
    });

    it('keeps observer active when enabled toggles', () => {
      const container = createMockContainer();

      const { rerender } = setupStreamingHook(container);

      rerender({ enabled: true });
      expect(resizeObserverDisconnect).not.toHaveBeenCalled();

      rerender({ enabled: false });
      // Observer stays active — not disconnected on enabled toggle
      expect(resizeObserverDisconnect).not.toHaveBeenCalled();
    });

    it('disconnects observer on unmount', () => {
      const container = createMockContainer();

      const { unmount } = setupStreamingHook(container);

      unmount();
      expect(resizeObserverDisconnect).toHaveBeenCalled();
    });
  });

  describe('post-streaming auto-scroll (typewriter drain)', () => {
    it('follows content growth after enabled goes false (user at bottom)', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);
      container.scrollTop = 600; // at bottom

      const { rerender } = setupStreamingHook(container);

      // Streaming phase
      rerender({ enabled: true });
      simulateContentGrowth(600);
      container.scrollToSpy.mockClear();

      // Streaming ends — enabled goes false
      rerender({ enabled: false });
      container.scrollToSpy.mockClear();

      // Typewriter still draining — content grows
      container.setScrollGeometry(1200, 400);
      simulateContentGrowth(800);

      expect(container.scrollToSpy).toHaveBeenCalledWith({
        top: 1200,
        behavior: 'instant',
      });
    });

    it('does NOT follow content shrinkage after enabled goes false', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);
      container.scrollTop = 600; // at bottom

      const { rerender } = setupStreamingHook(container);

      rerender({ enabled: true });
      simulateContentGrowth(600);
      container.scrollToSpy.mockClear();

      // Streaming ends
      rerender({ enabled: false });
      container.scrollToSpy.mockClear();

      // Content shrinks (e.g., layout shift) — should NOT auto-scroll
      simulateContentGrowth(500);

      expect(container.scrollToSpy).not.toHaveBeenCalled();
    });

    it('resumes auto-scroll when user scrolls to bottom after enabled goes false', () => {
      const container = createMockContainer();
      container.setScrollGeometry(1000, 400);
      container.scrollTop = 600; // at bottom

      const { rerender } = setupStreamingHook(container);

      rerender({ enabled: true });
      simulateContentGrowth(600);

      // User scrolls away during streaming
      act(() => {
        container.scrollTop = 100;
        container.fireScrollEvent();
      });

      // Streaming ends
      rerender({ enabled: false });
      container.scrollToSpy.mockClear();

      // Content grows — should NOT auto-scroll (user is away)
      container.setScrollGeometry(1100, 400);
      simulateContentGrowth(700);
      expect(container.scrollToSpy).not.toHaveBeenCalled();

      // User scrolls back to bottom
      act(() => {
        container.scrollTop = 700; // 1100 - 700 - 400 = 0
        container.fireScrollEvent();
      });
      container.scrollToSpy.mockClear();

      // Content grows again — should auto-scroll now
      container.setScrollGeometry(1200, 400);
      simulateContentGrowth(800);

      expect(container.scrollToSpy).toHaveBeenCalledWith({
        top: 1200,
        behavior: 'instant',
      });
    });
  });
});
