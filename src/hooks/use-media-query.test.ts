import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMediaQuery } from './use-media-query';

interface MockMediaQueryList {
  matches: boolean;
  media: string;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
  __listeners: Array<(event: { matches: boolean }) => void>;
}

const lists = new Map<string, MockMediaQueryList>();

function buildList(query: string, matches: boolean): MockMediaQueryList {
  const listeners: Array<(event: { matches: boolean }) => void> = [];
  return {
    matches,
    media: query,
    addEventListener: vi.fn((_event: string, cb) => {
      listeners.push(cb);
    }),
    removeEventListener: vi.fn((_event: string, cb) => {
      const idx = listeners.indexOf(cb);
      if (idx >= 0) listeners.splice(idx, 1);
    }),
    dispatchEvent: vi.fn(),
    __listeners: listeners,
  };
}

describe('useMediaQuery', () => {
  beforeEach(() => {
    lists.clear();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn((query: string) => {
        if (!lists.has(query)) lists.set(query, buildList(query, false));
        return lists.get(query) ?? buildList(query, false);
      }),
    });
  });

  afterEach(() => {
    lists.clear();
  });

  it('returns the current match value after mount', () => {
    lists.set('(min-width: 600px)', buildList('(min-width: 600px)', true));
    const { result } = renderHook(() => useMediaQuery('(min-width: 600px)'));
    expect(result.current).toBe(true);
  });

  it('updates when the media query fires a change event', () => {
    const list = buildList('(min-width: 600px)', false);
    lists.set('(min-width: 600px)', list);
    const { result } = renderHook(() => useMediaQuery('(min-width: 600px)'));
    expect(result.current).toBe(false);

    act(() => {
      list.__listeners.forEach((cb) => cb({ matches: true }));
    });

    expect(result.current).toBe(true);
  });

  it('removes its listener on unmount', () => {
    const list = buildList('(min-width: 600px)', false);
    lists.set('(min-width: 600px)', list);
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 600px)'));
    expect(list.addEventListener).toHaveBeenCalledTimes(1);
    unmount();
    expect(list.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
