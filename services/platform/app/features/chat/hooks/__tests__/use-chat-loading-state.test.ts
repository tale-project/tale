// @vitest-environment jsdom
import type { UIMessage } from '@convex-dev/agent/react';

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useChatLoadingState } from '../use-chat-loading-state';

function createUIMessage(
  overrides: Partial<UIMessage> & { id: string; order: number },
): UIMessage {
  return {
    key: overrides.id,
    role: 'assistant',
    text: '',
    _creationTime: Date.now(),
    status: 'success',
    parts: [],
    ...overrides,
  } as UIMessage;
}

const THREAD_A = 'thread-a';

describe('useChatLoadingState', () => {
  let setIsPending: (pending: boolean) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    setIsPending = vi.fn<(pending: boolean) => void>();
  });

  describe('Phase 1: active assistant (message-driven)', () => {
    it('returns true when any assistant message is streaming', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: false,
          setIsPending,
          uiMessages: [
            createUIMessage({
              id: 'msg-1',
              order: 0,
              role: 'assistant',
              status: 'streaming',
            }),
          ],
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('returns true when any assistant message is pending (tool call)', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: false,
          setIsPending,
          uiMessages: [
            createUIMessage({
              id: 'msg-1',
              order: 0,
              role: 'assistant',
              status: 'pending',
            }),
          ],
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('returns true when assistant message has undefined status', () => {
      const msg = createUIMessage({
        id: 'msg-1',
        order: 0,
        role: 'assistant',
      });
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test needs undefined status
      (msg as { status: unknown }).status = undefined;

      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: false,
          setIsPending,
          uiMessages: [msg],
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('returns false when all assistant messages are terminal', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: false,
          setIsPending,
          uiMessages: [
            createUIMessage({
              id: 'msg-1',
              order: 0,
              role: 'assistant',
              status: 'success',
            }),
            createUIMessage({
              id: 'msg-2',
              order: 1,
              role: 'assistant',
              status: 'failed',
            }),
          ],
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(false);
    });

    it('returns false when thread has only user messages and not pending', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: false,
          setIsPending,
          uiMessages: [
            createUIMessage({
              id: 'msg-1',
              order: 0,
              role: 'user',
              text: 'Hello',
            }),
          ],
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('Phase 2: send-gap bridge', () => {
    it('returns true when isPending and no messages exist', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          uiMessages: [],
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('returns true when isPending and uiMessages is undefined', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          uiMessages: undefined,
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('returns true when no new assistant message has appeared (send → message gap)', () => {
      const existingAssistant = createUIMessage({
        id: 'msg-1',
        order: 0,
        role: 'assistant',
        text: 'Previous answer',
        status: 'success',
      });
      const userMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'user',
        text: 'Follow up',
      });

      const messages = [existingAssistant, userMsg] as UIMessage[] | undefined;

      const { result, rerender } = renderHook(
        (props) => useChatLoadingState(props),
        {
          initialProps: {
            isPending: false as boolean,
            setIsPending,
            uiMessages: messages,
            threadId: THREAD_A as string | undefined,
            pendingThreadId: null as string | null,
          },
        },
      );

      // User sends — record baseline (1 assistant message)
      act(() => {
        result.current.setIsPendingWithBaseline(true);
      });

      rerender({
        isPending: true,
        setIsPending,
        uiMessages: messages,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      // No new assistant message yet — isLoading stays true
      expect(result.current.isLoading).toBe(true);
    });

    it('returns false when new assistant message reaches success', () => {
      const userMsg = createUIMessage({
        id: 'msg-1',
        order: 0,
        role: 'user',
        text: 'Hello',
      });

      const { result, rerender } = renderHook(
        (props) => useChatLoadingState(props),
        {
          initialProps: {
            isPending: true,
            setIsPending,
            uiMessages: [userMsg] as UIMessage[] | undefined,
            threadId: THREAD_A as string | undefined,
            pendingThreadId: THREAD_A as string | null,
          },
        },
      );

      const completedMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        text: 'Hi there!',
        status: 'success',
      });

      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg, completedMsg],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      // isLoading should be false immediately (same render frame)
      expect(result.current.isLoading).toBe(false);
    });

    it('returns false when isPending is false', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: false,
          setIsPending,
          uiMessages: [],
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('context sync (setIsPending)', () => {
    it('clears isPending when new assistant message reaches success', () => {
      const userMsg = createUIMessage({
        id: 'msg-1',
        order: 0,
        role: 'user',
        text: 'Hello',
      });
      const completedMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        text: 'Hi there!',
        status: 'success',
      });

      const { rerender } = renderHook((props) => useChatLoadingState(props), {
        initialProps: {
          isPending: true,
          setIsPending,
          uiMessages: [userMsg] as UIMessage[] | undefined,
          threadId: THREAD_A as string | undefined,
          pendingThreadId: THREAD_A as string | null,
        },
      });

      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg, completedMsg],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      expect(setIsPending).toHaveBeenCalledWith(false);
    });

    it('clears isPending when new assistant message reaches failed', () => {
      const userMsg = createUIMessage({
        id: 'msg-1',
        order: 0,
        role: 'user',
        text: 'Hello',
      });
      const failedMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        text: '',
        status: 'failed',
      });

      const { rerender } = renderHook((props) => useChatLoadingState(props), {
        initialProps: {
          isPending: true,
          setIsPending,
          uiMessages: [userMsg] as UIMessage[] | undefined,
          threadId: THREAD_A as string | undefined,
          pendingThreadId: THREAD_A as string | null,
        },
      });

      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg, failedMsg],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      expect(setIsPending).toHaveBeenCalledWith(false);
    });

    it('does not clear isPending while assistant is still streaming', () => {
      const userMsg = createUIMessage({
        id: 'msg-1',
        order: 0,
        role: 'user',
        text: 'Hello',
      });
      const streamingMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        status: 'streaming',
      });

      const { rerender } = renderHook((props) => useChatLoadingState(props), {
        initialProps: {
          isPending: true,
          setIsPending,
          uiMessages: [userMsg] as UIMessage[] | undefined,
          threadId: THREAD_A as string | undefined,
          pendingThreadId: THREAD_A as string | null,
        },
      });

      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg, streamingMsg],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      expect(setIsPending).not.toHaveBeenCalledWith(false);
    });

    it('does not clear isPending when no messages exist', () => {
      renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          uiMessages: [],
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
        }),
      );

      expect(setIsPending).not.toHaveBeenCalled();
    });

    it('does not clear isPending for pre-existing terminal messages when using setIsPendingWithBaseline', () => {
      const existingAssistant = createUIMessage({
        id: 'msg-1',
        order: 0,
        role: 'assistant',
        text: 'Previous answer',
        status: 'success',
      });
      const userMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'user',
        text: 'Follow up',
      });

      const messages = [existingAssistant, userMsg] as UIMessage[] | undefined;

      const { result, rerender } = renderHook(
        (props) => useChatLoadingState(props),
        {
          initialProps: {
            isPending: false as boolean,
            setIsPending,
            uiMessages: messages,
            threadId: THREAD_A as string | undefined,
            pendingThreadId: null as string | null,
          },
        },
      );

      // User sends a follow-up — setIsPendingWithBaseline tracks current assistant count (1)
      act(() => {
        result.current.setIsPendingWithBaseline(true);
      });

      rerender({
        isPending: true,
        setIsPending,
        uiMessages: messages,
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      // Should not clear — no new assistant message appeared yet
      expect(setIsPending).not.toHaveBeenCalledWith(false);
    });

    it('handles component remount during navigation', () => {
      const completedMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        text: 'Done',
        status: 'success',
      });

      // Simulates remount: isPending true from context, messages already loaded
      // assistantCountAtSendRef starts null, gets fallback baseline max(0, 1-1) = 0
      // Then count (1) > 0 → Phase 1 false (terminal), Phase 2 false (count > baseline) → clears
      renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          uiMessages: [completedMsg],
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
        }),
      );

      expect(setIsPending).toHaveBeenCalledWith(false);
    });
  });

  describe('thread scoping', () => {
    it('returns false when pendingThreadId does not match threadId', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          uiMessages: [],
          threadId: 'thread-b',
          pendingThreadId: THREAD_A,
        }),
      );

      expect(result.current.isLoading).toBe(false);
    });

    it('clears isPending when thread does not match (navigated away)', () => {
      renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          uiMessages: [],
          threadId: 'thread-b',
          pendingThreadId: THREAD_A,
        }),
      );

      expect(setIsPending).toHaveBeenCalledWith(false);
    });

    it('returns true when pendingThreadId matches threadId', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          uiMessages: [],
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('returns false on new-chat page when pendingThreadId is set (different thread pending)', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          uiMessages: undefined,
          threadId: undefined,
          pendingThreadId: THREAD_A,
        }),
      );

      expect(result.current.isLoading).toBe(false);
    });

    it('returns true on new-chat page when pendingThreadId is null (sent from new-chat)', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          uiMessages: undefined,
          threadId: undefined,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });
  });
});
