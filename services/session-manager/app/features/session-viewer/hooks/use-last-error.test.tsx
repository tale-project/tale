import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useLastError } from './use-last-error';

describe('useLastError', () => {
  it('is the error of the read', () => {
    const error = new Error('no');
    const { result } = renderHook(() => useLastError(error));
    expect(result.current).toBe(error);
  });

  it('is nothing until a read has failed', () => {
    const { result } = renderHook(() => useLastError(null));
    expect(result.current).toBeNull();
  });

  it('keeps the error while the read is made again, and takes the next one', () => {
    const first = new Error('first');
    const second = new Error('second');
    const { result, rerender } = renderHook<
      Error | null,
      { error: Error | null }
    >(({ error }) => useLastError(error), { initialProps: { error: first } });
    rerender({ error: null });
    expect(result.current).toBe(first);
    rerender({ error: second });
    expect(result.current).toBe(second);
    rerender({ error: null });
    expect(result.current).toBe(second);
  });
});
