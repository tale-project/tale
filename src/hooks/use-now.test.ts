import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNow } from './use-now';

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T07:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-reads the time once per interval', () => {
    const { result, unmount } = renderHook(() => useNow(1000));
    const start = result.current;
    expect(start).toBe(Date.parse('2026-10-09T07:00:00Z'));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(start + 1000);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(start + 4000);
    unmount();
  });

  it('runs one timer for every reader of an interval, and stops it after the last', () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    const clearInterval = vi.spyOn(globalThis, 'clearInterval');
    const readers = [1, 2, 3].map(() => renderHook(() => useNow(1000)));
    expect(setInterval).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const times = readers.map((reader) => reader.result.current);
    expect(new Set(times).size).toBe(1);
    readers[0].unmount();
    readers[1].unmount();
    expect(clearInterval).not.toHaveBeenCalled();
    readers[2].unmount();
    expect(clearInterval).toHaveBeenCalledTimes(1);
    setInterval.mockRestore();
    clearInterval.mockRestore();
  });

  it('answers the time of its first render, without a timer, when disabled', () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    const { result } = renderHook(() => useNow(1000, false));
    const first = result.current;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(first);
    expect(setInterval).not.toHaveBeenCalled();
    setInterval.mockRestore();
  });
});
