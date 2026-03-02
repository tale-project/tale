// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useChatLoadingState,
  type UseChatLoadingStateParams,
} from '../use-chat-loading-state';

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
          terminalAssistantCount: 0,
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
          terminalAssistantCount: 0,
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
          terminalAssistantCount: 0,
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
          terminalAssistantCount: 0,
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
          terminalAssistantCount: 0,
        },
      });

      rerender({
        isPending: true,
        setIsPending,
        isGenerating: true,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
        terminalAssistantCount: 0,
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
          terminalAssistantCount: 0,
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
            terminalAssistantCount: 0,
          },
        },
      );

      rerender({
        isPending: false,
        setIsPending,
        isGenerating: true,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
        terminalAssistantCount: 0,
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
          terminalAssistantCount: 0,
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
          terminalAssistantCount: 0,
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
          terminalAssistantCount: 0,
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
          terminalAssistantCount: 0,
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
          terminalAssistantCount: 0,
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
          terminalAssistantCount: 0,
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
          terminalAssistantCount: 0,
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
            terminalAssistantCount: 0,
          },
        },
      );

      expect(result.current.isLoading).toBe(true);

      rerender({
        isPending: false,
        setIsPending,
        isGenerating: true,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
        terminalAssistantCount: 0,
      });
      expect(result.current.isLoading).toBe(true);

      rerender({
        isPending: false,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: null,
        terminalAssistantCount: 0,
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
            terminalAssistantCount: 0,
          },
        },
      );

      expect(result.current.isLoading).toBe(true);

      rerender({
        isPending: false,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: null,
        terminalAssistantCount: 0,
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('terminal assistant count', () => {
    it('clears isPending when terminalAssistantCount increases and isGenerating was never true', () => {
      const { rerender } = renderHook((props) => useChatLoadingState(props), {
        initialProps: {
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
          terminalAssistantCount: 0,
        },
      });

      expect(setIsPending).not.toHaveBeenCalledWith(false);

      rerender({
        isPending: true,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
        terminalAssistantCount: 1,
      });

      expect(setIsPending).toHaveBeenCalledWith(false);
    });

    it('clears isPending when terminalAssistantCount increases while isGenerating is also true', () => {
      const { rerender } = renderHook((props) => useChatLoadingState(props), {
        initialProps: {
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
          terminalAssistantCount: 0,
        },
      });

      rerender({
        isPending: true,
        setIsPending,
        isGenerating: true,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
        terminalAssistantCount: 1,
      });

      expect(setIsPending).toHaveBeenCalledWith(false);
    });

    it('does not clear isPending when terminalAssistantCount unchanged', () => {
      const { rerender } = renderHook<
        ReturnType<typeof useChatLoadingState>,
        UseChatLoadingStateParams
      >((props) => useChatLoadingState(props), {
        initialProps: {
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
          terminalAssistantCount: 0,
        },
      });

      rerender({
        isPending: true,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
        terminalAssistantCount: 0,
      });

      expect(setIsPending).not.toHaveBeenCalledWith(false);
    });

    it('resets baseline when isPending transitions to false', () => {
      const { rerender } = renderHook<
        ReturnType<typeof useChatLoadingState>,
        UseChatLoadingStateParams
      >((props) => useChatLoadingState(props), {
        initialProps: {
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
          terminalAssistantCount: 3,
        },
      });

      rerender({
        isPending: false,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: null,
        terminalAssistantCount: 3,
      });

      setIsPending.mockClear();

      rerender({
        isPending: true,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
        terminalAssistantCount: 3,
      });

      expect(setIsPending).not.toHaveBeenCalledWith(false);

      rerender({
        isPending: true,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
        terminalAssistantCount: 4,
      });

      expect(setIsPending).toHaveBeenCalledWith(false);
    });

    it('captures new baseline on subsequent send', () => {
      const { rerender } = renderHook<
        ReturnType<typeof useChatLoadingState>,
        UseChatLoadingStateParams
      >((props) => useChatLoadingState(props), {
        initialProps: {
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
          terminalAssistantCount: 0,
        },
      });

      rerender({
        isPending: true,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
        terminalAssistantCount: 1,
      });

      expect(setIsPending).toHaveBeenCalledWith(false);
      setIsPending.mockClear();

      rerender({
        isPending: false,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: null,
        terminalAssistantCount: 1,
      });

      rerender({
        isPending: true,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
        terminalAssistantCount: 1,
      });

      expect(setIsPending).not.toHaveBeenCalledWith(false);

      rerender({
        isPending: true,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
        terminalAssistantCount: 2,
      });

      expect(setIsPending).toHaveBeenCalledWith(false);
    });

    it('does not clear when terminalAssistantCount starts non-zero', () => {
      const { rerender } = renderHook((props) => useChatLoadingState(props), {
        initialProps: {
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
          terminalAssistantCount: 5,
        },
      });

      expect(setIsPending).not.toHaveBeenCalledWith(false);

      rerender({
        isPending: true,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
        terminalAssistantCount: 5,
      });

      expect(setIsPending).not.toHaveBeenCalledWith(false);

      rerender({
        isPending: true,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
        terminalAssistantCount: 6,
      });

      expect(setIsPending).toHaveBeenCalledWith(false);
    });

    it('handles terminalAssistantCount of 0 when messages not yet loaded', () => {
      const { rerender } = renderHook((props) => useChatLoadingState(props), {
        initialProps: {
          isPending: true,
          setIsPending,
          isGenerating: false,
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
          terminalAssistantCount: 0,
        },
      });

      expect(setIsPending).not.toHaveBeenCalledWith(false);

      rerender({
        isPending: true,
        setIsPending,
        isGenerating: false,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
        terminalAssistantCount: 0,
      });

      expect(setIsPending).not.toHaveBeenCalledWith(false);
    });
  });
});
