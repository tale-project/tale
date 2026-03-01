// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatLoadingState } from '../use-chat-loading-state';

const THREAD_A = 'thread-a';
const SAFETY_TIMEOUT_MS = 60_000;

describe('useChatLoadingState', () => {
  let setIsPending: ReturnType<typeof vi.fn<(pending: boolean) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setIsPending = vi.fn<(pending: boolean) => void>();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isLoading derivation', () => {
    it('returns true when isPending is true and isGenerating is false', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('returns true when isGenerating is true and isPending is false', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: false,
          setIsPending,
          isGenerating: true,
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('returns true when both isPending and isGenerating are true', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          isGenerating: true,
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('returns false when both isPending and isGenerating are false', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: false,
          setIsPending,
          isGenerating: false,
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('handoff: isPending cleared when isGenerating takes over', () => {
    it('clears isPending when isGenerating becomes true', () => {
      const { rerender } = renderHook((props) => useChatLoadingState(props), {
        initialProps: {
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
        },
      });

      // Server confirms generation started
      rerender({
        isPending: true,
        setIsPending,
        isGenerating: true,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      expect(setIsPending).toHaveBeenCalledWith(false);
    });

    it('does not clear isPending when isGenerating is still false', () => {
      renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
        }),
      );

      expect(setIsPending).not.toHaveBeenCalledWith(false);
    });

    it('isLoading remains true during handoff (isPending cleared, isGenerating true)', () => {
      const { result, rerender } = renderHook(
        (props) => useChatLoadingState(props),
        {
          initialProps: {
            isPending: true,
            setIsPending,
            isGenerating: false,
            threadId: THREAD_A,
            pendingThreadId: THREAD_A,
          },
        },
      );

      // After handoff, simulate external state update: isPending=false, isGenerating=true
      rerender({
        isPending: false,
        setIsPending,
        isGenerating: true,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('safety timeout', () => {
    it('clears isPending after safety timeout', () => {
      renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
        }),
      );

      act(() => {
        vi.advanceTimersByTime(SAFETY_TIMEOUT_MS);
      });

      expect(setIsPending).toHaveBeenCalledWith(false);
    });

    it('does not trigger safety timeout before the timeout period', () => {
      renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
        }),
      );

      act(() => {
        vi.advanceTimersByTime(SAFETY_TIMEOUT_MS - 1);
      });

      expect(setIsPending).not.toHaveBeenCalledWith(false);
    });

    it('does not trigger safety timeout when isPending is false', () => {
      renderHook(() =>
        useChatLoadingState({
          isPending: false,
          setIsPending,
          isGenerating: true,
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      act(() => {
        vi.advanceTimersByTime(SAFETY_TIMEOUT_MS);
      });

      expect(setIsPending).not.toHaveBeenCalled();
    });
  });

  describe('thread scoping', () => {
    it('clears isPending when pendingThreadId does not match threadId', () => {
      renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: 'thread-b',
          pendingThreadId: THREAD_A,
        }),
      );

      expect(setIsPending).toHaveBeenCalledWith(false);
    });

    it('keeps isPending when pendingThreadId matches threadId', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
        }),
      );

      expect(result.current.isLoading).toBe(true);
      expect(setIsPending).not.toHaveBeenCalledWith(false);
    });

    it('clears isPending on new-chat page when pendingThreadId is set (navigated away)', () => {
      renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: undefined,
          pendingThreadId: THREAD_A,
        }),
      );

      expect(setIsPending).toHaveBeenCalledWith(false);
    });

    it('keeps isPending on new-chat page when pendingThreadId is null (sent from new-chat)', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: undefined,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(true);
      expect(setIsPending).not.toHaveBeenCalled();
    });
  });

  describe('generation lifecycle', () => {
    it('tracks full lifecycle: pending → generating → complete', () => {
      const { result, rerender } = renderHook(
        (props) => useChatLoadingState(props),
        {
          initialProps: {
            isPending: true,
            setIsPending,
            isGenerating: false,
            threadId: THREAD_A,
            pendingThreadId: THREAD_A as string | null,
          },
        },
      );

      // Phase 1: isPending bridges the gap
      expect(result.current.isLoading).toBe(true);

      // Phase 2: Server confirms generation (handoff clears isPending)
      rerender({
        isPending: false,
        setIsPending,
        isGenerating: true,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });
      expect(result.current.isLoading).toBe(true);

      // Phase 3: Generation completes
      rerender({
        isPending: false,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: null,
      });
      expect(result.current.isLoading).toBe(false);
    });

    it('handles generation failure (isGenerating goes false)', () => {
      const { result, rerender } = renderHook(
        (props) => useChatLoadingState(props),
        {
          initialProps: {
            isPending: false,
            setIsPending,
            isGenerating: true,
            threadId: THREAD_A,
            pendingThreadId: null,
          },
        },
      );

      expect(result.current.isLoading).toBe(true);

      // Stream aborted or failed
      rerender({
        isPending: false,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: null,
      });

      expect(result.current.isLoading).toBe(false);
    });
  });
});
