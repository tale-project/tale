// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMutateAsync = vi.fn();

vi.mock('../mutations', () => ({
  useCancelGeneration: () => ({ mutateAsync: mockMutateAsync }),
}));

const mockFreezeActiveStream = vi.fn();
const mockConsumeFrozenDisplayText = vi.fn();
const mockResetGlobalFreeze = vi.fn();

vi.mock('../use-stream-buffer', () => ({
  freezeActiveStream: (...args: unknown[]) => mockFreezeActiveStream(...args),
  consumeFrozenDisplayText: () => mockConsumeFrozenDisplayText(),
  resetGlobalFreeze: () => mockResetGlobalFreeze(),
}));

import { useStopGenerating } from '../use-stop-generating';

// ============================================================================
// Happy path
// ============================================================================

describe('useStopGenerating — happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue(null);
    mockConsumeFrozenDisplayText.mockReturnValue(null);
  });

  it('calls freezeActiveStream, consumeFrozenDisplayText, and cancelGeneration on stop', () => {
    mockConsumeFrozenDisplayText.mockReturnValue('Hello, this is partial');

    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    act(() => result.current.stopGenerating());

    expect(mockFreezeActiveStream).toHaveBeenCalledOnce();
    expect(mockConsumeFrozenDisplayText).toHaveBeenCalledOnce();
    expect(mockMutateAsync).toHaveBeenCalledWith({
      threadId: 'thread-1',
      displayedContent: 'Hello, this is partial',
    });
  });

  it('passes null displayedContent when no text was captured', () => {
    mockConsumeFrozenDisplayText.mockReturnValue(null);

    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    act(() => result.current.stopGenerating());

    expect(mockMutateAsync).toHaveBeenCalledWith({
      threadId: 'thread-1',
      displayedContent: null,
    });
  });

  it('calls operations in the correct order: freeze → consume → mutate', () => {
    const callOrder: string[] = [];
    mockFreezeActiveStream.mockImplementation(() => callOrder.push('freeze'));
    mockConsumeFrozenDisplayText.mockImplementation(() => {
      callOrder.push('consume');
      return 'partial text';
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
    mockConsumeFrozenDisplayText.mockReturnValue(null);
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

  it('passes empty string displayedContent through (not treated as null)', () => {
    mockConsumeFrozenDisplayText.mockReturnValue('');

    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    act(() => result.current.stopGenerating());

    expect(mockMutateAsync).toHaveBeenCalledWith({
      threadId: 'thread-1',
      displayedContent: '',
    });
  });

  it('does not crash when mutation rejects', async () => {
    mockMutateAsync.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    // Should not throw synchronously — mutation is fire-and-forget (void)
    act(() => result.current.stopGenerating());

    // freeze and consume should still have been called
    expect(mockFreezeActiveStream).toHaveBeenCalledOnce();
    expect(mockConsumeFrozenDisplayText).toHaveBeenCalledOnce();
  });

  it('resetCancelled is idempotent (calling multiple times is safe)', () => {
    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    act(() => result.current.stopGenerating());

    // Reset multiple times
    act(() => {
      result.current.resetCancelled();
      result.current.resetCancelled();
      result.current.resetCancelled();
    });

    // Should be able to stop again (exactly once)
    act(() => result.current.stopGenerating());
    expect(mockMutateAsync).toHaveBeenCalledTimes(2);
  });

  it('handles threadId switching from undefined to defined', () => {
    const { result, rerender } = renderHook(
      ({ threadId }) => useStopGenerating({ threadId }),
      { initialProps: { threadId: undefined as string | undefined } },
    );

    // First try with undefined — should do nothing
    act(() => result.current.stopGenerating());
    expect(mockMutateAsync).not.toHaveBeenCalled();

    // Now provide a threadId
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

    // Switch threadId without resetting cancelled
    rerender({ threadId: 'thread-2' });
    act(() => result.current.stopGenerating());

    // Should still be blocked by cancelled flag
    expect(mockMutateAsync).toHaveBeenCalledOnce();
  });

  it('passes long displayedContent without truncation', () => {
    const longContent = 'A'.repeat(10000);
    mockConsumeFrozenDisplayText.mockReturnValue(longContent);

    const { result } = renderHook(() =>
      useStopGenerating({ threadId: 'thread-1' }),
    );

    act(() => result.current.stopGenerating());

    expect(mockMutateAsync).toHaveBeenCalledWith({
      threadId: 'thread-1',
      displayedContent: longContent,
    });
  });
});
