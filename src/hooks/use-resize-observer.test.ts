import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useResizeObserver } from './use-resize-observer';

type Callback = (entries: ResizeObserverEntry[]) => void;

let instances: Array<{
  callback: Callback;
  observed: Element[];
  disconnected: boolean;
}>;

class FakeResizeObserver {
  private readonly record: (typeof instances)[number];
  constructor(callback: Callback) {
    this.record = { callback, observed: [], disconnected: false };
    instances.push(this.record);
  }
  observe(target: Element) {
    this.record.observed.push(target);
  }
  unobserve() {}
  disconnect() {
    this.record.disconnected = true;
  }
}

function fire(index: number, target: Element) {
  const entry = { target, contentRect: { width: 10, height: 10 } };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial entry is enough for the hook
  instances[index].callback([entry as unknown as ResizeObserverEntry]);
}

describe('useResizeObserver', () => {
  const original = globalThis.ResizeObserver;

  beforeEach(() => {
    instances = [];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    globalThis.ResizeObserver =
      FakeResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  it('observes a single element and hands the entry to the callback', () => {
    const element = document.createElement('div');
    const callback = vi.fn();
    renderHook(() => useResizeObserver(element, callback));

    expect(instances[0].observed).toEqual([element]);
    fire(0, element);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ target: element }),
      element,
    );
  });

  it('does nothing while the target is absent', () => {
    renderHook(() => useResizeObserver(null, vi.fn()));
    expect(instances).toHaveLength(0);
  });

  it('observes every element behind an array of refs', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    const refs = [{ current: a }, { current: null }, { current: b }];
    const callback = vi.fn();
    renderHook(() => useResizeObserver(refs, callback));

    expect(instances[0].observed).toEqual([a, b]);
    fire(0, b);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('observes the elements held by one ref of an array', () => {
    const a = document.createElement('div');
    const ref = { current: [a, null] };
    renderHook(() => useResizeObserver(ref, vi.fn()));
    expect(instances[0].observed).toEqual([a]);
  });

  it('also listens to the window when asked, and stops on unmount', () => {
    const callback = vi.fn();
    const ref = { current: document.createElement('div') };
    const { unmount } = renderHook(() =>
      useResizeObserver(ref, callback, { listenToWindow: true }),
    );

    window.dispatchEvent(new Event('resize'));
    expect(callback).toHaveBeenCalledTimes(1);

    unmount();
    expect(instances[0].disconnected).toBe(true);
    window.dispatchEvent(new Event('resize'));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('uses the latest callback without re-attaching the observer', () => {
    const element = document.createElement('div');
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ cb }) => useResizeObserver(element, cb),
      { initialProps: { cb: first } },
    );
    rerender({ cb: second });

    expect(instances).toHaveLength(1);
    fire(0, element);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
