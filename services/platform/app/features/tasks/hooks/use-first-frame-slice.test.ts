import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useFirstFrameSlice } from './use-first-frame-slice';

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => `row-${index}`);

describe('useFirstFrameSlice', () => {
  it('answers the first screens first, then every row', async () => {
    const seen: number[] = [];
    const items = rows(200);
    const { result } = renderHook(() => {
      const shown = useFirstFrameSlice(items, 20);
      seen.push(shown.length);
      return shown;
    });

    expect(seen[0]).toBe(20);
    await act(async () => {});
    expect(result.current).toBe(items);
  });

  it('slices rows that arrive after mount the same way', async () => {
    const seen: number[] = [];
    const { result, rerender } = renderHook(
      ({ items }: { items: readonly string[] }) => {
        const shown = useFirstFrameSlice(items, 20);
        seen.push(shown.length);
        return shown;
      },
      { initialProps: { items: [] as readonly string[] } },
    );
    expect(result.current).toEqual([]);

    const items = rows(150);
    seen.length = 0;
    rerender({ items });
    expect(seen[0]).toBe(20);
    await act(async () => {});
    expect(result.current).toBe(items);
  });

  it('hands a short list through whole', () => {
    const items = rows(5);
    const { result } = renderHook(() => useFirstFrameSlice(items, 20));
    expect(result.current).toBe(items);
  });
});
