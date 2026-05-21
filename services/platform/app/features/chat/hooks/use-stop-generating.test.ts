// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMutateAsync = vi.fn();

vi.mock('./mutations', () => ({
  useCancelGeneration: () => ({ mutateAsync: mockMutateAsync }),
}));

const mockFreezeActiveStream = vi.fn();
const mockConsumeFrozenDisplayLength = vi.fn();
const mockResetGlobalFreeze = vi.fn();

vi.mock('./use-stream-buffer', () => ({
  freezeActiveStream: (...args: unknown[]) => mockFreezeActiveStream(...args),
  consumeFrozenDisplayLength: () => mockConsumeFrozenDisplayLength(),
  resetGlobalFreeze: () => mockResetGlobalFreeze(),
}));

import { useStopGenerating } from './use-stop-generating';

// ============================================================================
// Happy path
// ============================================================================

describe('useStopGenerating — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue(null);
    mockConsumeFrozenDisplayLength.mockReturnValue(null);
  });

  it('calls freezeActiveStream, consumeFrozenDisplayLength, and cancelGeneration on stop', () => {
    mockConsumeFrozenDisplayLength.mockReturnValue(22);

    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    act(() => result.current.stopGenerating());

    expect(mockFreezeActiveStream).toHaveBeenCalledOnce();
    expect(mockConsumeFrozenDisplayLength).toHaveBeenCalledOnce();
    expect(mockMutateAsync).toHaveBeenCalledWith({
      threadId: 'thread-1',
      displayedLength: 22,
    });
  });

  it('passes null displayedLength when no length was captured', () => {
    mockConsumeFrozenDisplayLength.mockReturnValue(null);

    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    act(() => result.current.stopGenerating());

    expect(mockMutateAsync).toHaveBeenCalledWith({
      threadId: 'thread-1',
      displayedLength: null,
    });
  });

  it('calls operations in the correct order: freeze → consume → mutate', () => {
    const callOrder: string[] = [];
    mockFreezeActiveStream.mockImplementation(() => callOrder.push('freeze'));
    mockConsumeFrozenDisplayLength.mockImplementation(() => {
      callOrder.push('consume');
      return 12;
    });
    mockMutateAsync.mockImplementation(() => {
      callOrder.push('mutate');
      return Promise.resolve(null);
    });

    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    act(() => result.current.stopGenerating());

    expect(callOrder).toEqual(['freeze', 'consume', 'mutate']);
  });

  it('allows stopping again after resetCancelled', () => {
    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    act(() => result.current.stopGenerating());
    expect(mockMutateAsync).toHaveBeenCalledOnce();

    act(() => result.current.resetCancelled());
    act(() => result.current.stopGenerating());
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
  });

  it('resetCancelled clears the global freeze so the next response can render', () => {
    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    act(() => result.current.stopGenerating());
    mockResetGlobalFreeze.mockClear();

    act(() => result.current.resetCancelled());
    expect(mockResetGlobalFreeze).toHaveBeenCalledOnce();
  });

  it('uses the threadId from the most recent render', () => {
    const { result, rerender } = renderHook(
      ({ threadId }) => useStopGenerating({ threadId }),
      { initialProps: { threadId: 'thread-1' as string | undefined } },
    );

    rerender({ threadId: 'thread-2' });
    act(() => result.current.stopGenerating());

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-2' }),
    );
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('useStopGenerating — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue(null);
    mockConsumeFrozenDisplayLength.mockReturnValue(null);
  });

  it('does nothing when threadId is undefined', () => {
    const { result } = renderHook(() =>
      useStopGenerating({ threadId: undefined }),
    );

    act(() => result.current.stopGenerating());

    expect(mockFreezeActiveStream).not.toHaveBeenCalled();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('does not fire twice (cancelled flag prevents duplicate calls)', () => {
    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    act(() => result.current.stopGenerating());
    act(() => result.current.stopGenerating());

    expect(mockFreezeActiveStream).toHaveBeenCalledOnce();
    expect(mockMutateAsync).toHaveBeenCalledOnce();
  });

  it('passes displayedLength=0 through (not coerced to null) — backend treats it as no-snapshot', () => {
    mockConsumeFrozenDisplayLength.mockReturnValue(0);

    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    act(() => result.current.stopGenerating());

    expect(mockMutateAsync).toHaveBeenCalledWith({
      threadId: 'thread-1',
      displayedLength: 0,
    });
  });

  it('does not crash when mutation rejects', () => {
    mockMutateAsync.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    // Should not throw synchronously — mutation is fire-and-forget (void)
    act(() => result.current.stopGenerating());

    // freeze and consume should still have been called
    expect(mockFreezeActiveStream).toHaveBeenCalledOnce();
    expect(mockConsumeFrozenDisplayLength).toHaveBeenCalledOnce();
  });

  it('resetCancelled is idempotent (calling multiple times is safe)', () => {
    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    act(() => result.current.stopGenerating());

    act(() => {
      result.current.resetCancelled();
      result.current.resetCancelled();
      result.current.resetCancelled();
    });

    act(() => result.current.stopGenerating());
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
  });

  it('handles threadId switching from undefined to defined', () => {
    const { result, rerender } = renderHook(
      ({ threadId }) => useStopGenerating({ threadId }),
      { initialProps: { threadId: undefined as string | undefined } },
    );

    act(() => result.current.stopGenerating());
    expect(mockMutateAsync).not.toHaveBeenCalled();

    rerender({ threadId: 'thread-1' });
    act(() => result.current.stopGenerating());
    expect(mockMutateAsync).toHaveBeenCalledOnce();
  });

  it('preserves cancelled state across threadId changes', () => {
    const { result, rerender } = renderHook(
      ({ threadId }) => useStopGenerating({ threadId }),
      { initialProps: { threadId: 'thread-1' as string | undefined } },
    );

    act(() => result.current.stopGenerating());
    expect(mockMutateAsync).toHaveBeenCalledOnce();

    rerender({ threadId: 'thread-2' });
    act(() => result.current.stopGenerating());

    expect(mockMutateAsync).toHaveBeenCalledOnce();
  });

  it('passes large displayedLength without modification', () => {
    mockConsumeFrozenDisplayLength.mockReturnValue(100000);

    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    act(() => result.current.stopGenerating());

    expect(mockMutateAsync).toHaveBeenCalledWith({
      threadId: 'thread-1',
      displayedLength: 100000,
    });
  });
});
