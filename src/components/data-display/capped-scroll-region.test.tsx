// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { CappedScrollRegion } from './capped-scroll-region';

/**
 * jsdom's ResizeObserver mock never fires, and scroll metrics are 0. The
 * suite drives overflow by stubbing geometry and invoking the observer
 * callback the component registers — the same path a real resize takes.
 */
describe('CappedScrollRegion', () => {
  it('caps the region and keeps short content free of a scroll affordance', () => {
    const { container } = render(
      <CappedScrollRegion
        maxHeightClassName="max-h-40"
        scrollLabel="Scroll down"
      >
        <div>fits</div>
      </CappedScrollRegion>,
    );

    const scroller = container.querySelector('.max-h-40');
    expect(scroller).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Scroll down' }),
    ).not.toBeInTheDocument();
  });

  it('shows the gradient and scroll button when content overflows', () => {
    type ObserverCallback = ResizeObserverCallback;
    let observerCallback: ObserverCallback | null = null;

    class RecordingResizeObserver {
      constructor(callback: ObserverCallback) {
        observerCallback = callback;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    globalThis.ResizeObserver = RecordingResizeObserver;

    const { container } = render(
      <CappedScrollRegion
        maxHeightClassName="max-h-40"
        scrollLabel="Scroll down"
      >
        <div>tall content</div>
      </CappedScrollRegion>,
    );

    const scroller = container.querySelector('.max-h-40');
    expect(scroller).toBeInstanceOf(HTMLElement);
    if (!(scroller instanceof HTMLElement)) return;

    Object.defineProperty(scroller, 'scrollHeight', {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(scroller, 'clientHeight', {
      configurable: true,
      get: () => 160,
    });
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => 0,
    });

    act(() => {
      observerCallback?.([], {} as ResizeObserver);
    });

    expect(
      screen.getByRole('button', { name: 'Scroll down' }),
    ).toBeInTheDocument();
  });

  it('scrolls to the bottom when the affordance is activated', async () => {
    type ObserverCallback = ResizeObserverCallback;
    let observerCallback: ObserverCallback | null = null;

    class RecordingResizeObserver {
      constructor(callback: ObserverCallback) {
        observerCallback = callback;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    globalThis.ResizeObserver = RecordingResizeObserver;

    const scrollTo = vi.fn();
    const { container, user } = render(
      <CappedScrollRegion
        maxHeightClassName="max-h-40"
        scrollLabel="Scroll down"
      >
        <div>tall content</div>
      </CappedScrollRegion>,
    );

    const scroller = container.querySelector('.max-h-40');
    expect(scroller).toBeInstanceOf(HTMLElement);
    if (!(scroller instanceof HTMLElement)) return;

    Object.defineProperty(scroller, 'scrollHeight', {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(scroller, 'clientHeight', {
      configurable: true,
      get: () => 160,
    });
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => 0,
    });
    scroller.scrollTo = scrollTo;

    act(() => {
      observerCallback?.([], {} as ResizeObserver);
    });

    await user.click(screen.getByRole('button', { name: 'Scroll down' }));
    expect(scrollTo).toHaveBeenCalledWith({
      top: 400,
      behavior: 'smooth',
    });
  });
});
