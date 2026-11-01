import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { observeElementOffset, useVirtualList } from './use-virtual-list';

const ports: HTMLDivElement[] = [];

function scrollport(horizontal = false, rtl = false) {
  const port = document.createElement('div');
  port.style.cssText = 'height:240px;width:320px;overflow:auto';
  if (rtl) port.dir = 'rtl';
  const space = document.createElement('div');
  space.style.height = horizontal ? '100%' : '4000px';
  space.style.width = horizontal ? '4000px' : '100%';
  port.append(space);
  document.body.append(port);
  ports.push(port);
  return port;
}

afterEach(() => {
  cleanup();
  for (const port of ports.splice(0)) port.remove();
});

describe('useVirtualList native offsets (Chromium)', () => {
  it.each([
    ['number', 500],
    ['function', () => 500],
  ] as const)(
    'keeps the requested %s initial offset when the native scrollport starts at zero',
    (_kind, initialOffset) => {
      const port = scrollport();
      expect(port.scrollTop).toBe(0);
      const { result } = renderHook(() =>
        useVirtualList<HTMLDivElement, HTMLDivElement>({
          count: 40,
          estimateSize: () => 100,
          getScrollElement: () => port,
          initialOffset,
        }),
      );

      expect(port.scrollTop).toBe(500);
      expect(result.current.scrollOffset).toBe(500);
      expect(
        result.current.getVirtualItems().some((row) => row.index === 5),
      ).toBe(true);
    },
  );

  it('keeps an explicit zero instead of adopting an existing native offset', () => {
    const port = scrollport();
    port.scrollTop = 350;
    expect(port.scrollTop).toBe(350);
    const { result } = renderHook(() =>
      useVirtualList<HTMLDivElement, HTMLDivElement>({
        count: 40,
        estimateSize: () => 100,
        getScrollElement: () => port,
        initialOffset: 0,
      }),
    );

    expect(port.scrollTop).toBe(0);
    expect(result.current.scrollOffset).toBe(0);
  });

  it('adopts the existing native offset when no initial offset was supplied', () => {
    const port = scrollport();
    port.scrollTop = 350;
    expect(port.scrollTop).toBe(350);
    const { result } = renderHook(() =>
      useVirtualList<HTMLDivElement, HTMLDivElement>({
        count: 40,
        estimateSize: () => 100,
        getScrollElement: () => port,
      }),
    );

    expect(port.scrollTop).toBe(350);
    expect(result.current.scrollOffset).toBe(350);
  });

  it('preserves a caller-owned observer and releases it on unmount', () => {
    const port = scrollport();
    const observed = vi.fn();
    const disconnected = vi.fn();
    const observer: typeof observeElementOffset = (instance, callback) => {
      observed();
      const unsubscribe = observeElementOffset(instance, callback);
      callback(275, false);
      return () => {
        unsubscribe?.();
        disconnected();
      };
    };
    const { result, unmount } = renderHook(() =>
      useVirtualList<HTMLDivElement, HTMLDivElement>({
        count: 40,
        estimateSize: () => 100,
        getScrollElement: () => port,
        initialOffset: 500,
        observeElementOffset: observer,
      }),
    );

    expect(port.scrollTop).toBe(275);
    expect(result.current.scrollOffset).toBe(275);
    expect(observed).toHaveBeenCalledOnce();
    unmount();
    expect(disconnected).toHaveBeenCalledOnce();
  });

  it('keeps logical RTL offsets and a caller-owned horizontal scroll function', () => {
    const port = scrollport(true, true);
    port.scrollLeft = -350;
    expect(port.scrollLeft).toBe(-350);
    const { result } = renderHook(() =>
      useVirtualList<HTMLDivElement, HTMLDivElement>({
        count: 40,
        estimateSize: () => 100,
        getScrollElement: () => port,
        horizontal: true,
        isRtl: true,
        scrollToFn: (offset, { adjustments = 0, behavior }, instance) => {
          instance.scrollElement?.scrollTo({
            left: -(offset + adjustments),
            behavior,
          });
        },
      }),
    );

    expect(port.scrollLeft).toBe(-350);
    expect(result.current.scrollOffset).toBe(350);
  });
});

describe('useVirtualList scroll anchoring (Chromium)', () => {
  // Forty 100px rows, the scrollport opened at `offset`.
  function anchoredList(offset: number) {
    const port = scrollport();
    const { result } = renderHook(() =>
      useVirtualList<HTMLDivElement, HTMLDivElement>({
        count: 40,
        estimateSize: () => 100,
        getScrollElement: () => port,
        initialOffset: offset,
      }),
    );
    expect(port.scrollTop).toBe(offset);
    return { port, list: result };
  }

  it('keeps a scroll restore when a row above it is measured before its scroll event arrives', () => {
    const { port, list } = anchoredList(1000);
    // A restore moves the scrollport; its scroll event arrives a frame later.
    port.scrollTop = 500;
    act(() => list.current.resizeItem(1, 180));
    // TanStack alone compensates from the old offset, to 1080.
    expect(port.scrollTop).toBe(500);
    expect(list.current.getTotalSize()).toBe(4080);
  });

  it('keeps the rows in view in place when a row above them is measured for the first time', () => {
    const { port, list } = anchoredList(1000);
    act(() => list.current.resizeItem(1, 180));
    expect(port.scrollTop).toBe(1080);
  });

  it('keeps the offset when a measured row across the top edge grows again', () => {
    const { port, list } = anchoredList(1050);
    act(() => list.current.resizeItem(10, 120));
    expect(port.scrollTop).toBe(1070);
    // Its growth lies below the top edge: following it would drag the view.
    act(() => list.current.resizeItem(10, 200));
    expect(port.scrollTop).toBe(1070);
  });
});
