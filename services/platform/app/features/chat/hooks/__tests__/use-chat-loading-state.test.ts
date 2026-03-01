// @vitest-environment jsdom
import type { UIMessage } from '@convex-dev/agent/react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatLoadingState } from '../use-chat-loading-state';

let creationTimeCounter = 1_000_000;

function createUIMessage(
  overrides: Partial<UIMessage> & { id: string; order: number },
): UIMessage {
  creationTimeCounter += 1;
  return {
    key: overrides.id,
    role: 'assistant',
    text: '',
    _creationTime: creationTimeCounter,
    status: 'success',
    parts: [],
    ...overrides,
  } as UIMessage;
}

const THREAD_A = 'thread-a';
const DEBOUNCE_MS = 2_000;

describe('useChatLoadingState', () => {
  let setIsPending: (pending: boolean) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setIsPending = vi.fn<(pending: boolean) => void>();
    creationTimeCounter = 1_000_000;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('last message check', () => {
    it('returns true when last assistant message is streaming', () => {
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

    it('returns true when last assistant message is pending (tool call)', () => {
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

    it('returns true when last assistant message has undefined status', () => {
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

    it('returns false when last assistant message is terminal', () => {
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

    it('returns false when failed mid-tool-call (failed is unconditionally terminal)', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: false,
          setIsPending,
          uiMessages: [
            createUIMessage({
              id: 'msg-1',
              order: 0,
              role: 'assistant',
              status: 'failed',
              text: 'Let me look that up.',
              parts: [
                { type: 'text', text: 'Let me look that up.' },
                { type: 'step-start' },
                {
                  type: 'tool-rag_search',
                  toolCallId: 'call-1',
                  input: { query: 'test' },
                  state: 'input-available',
                },
              ],
            }),
          ],
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(false);
    });

    it('returns true when last message is user (waiting for AI response)', () => {
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

      expect(result.current.isLoading).toBe(true);
    });

    it('keeps isLoading true via isPending until debounce clears it', () => {
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

      // Subscription delivers streaming message
      const streamingMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        status: 'streaming',
      });

      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg, streamingMsg],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      expect(result.current.isLoading).toBe(true);

      // Generation completes
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

      // isPending still true (debounce hasn't fired), so isLoading stays true
      expect(result.current.isLoading).toBe(true);

      // After debounce, isPending is cleared
      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS);
      });

      expect(setIsPending).toHaveBeenCalledWith(false);
    });
  });

  describe('isPending bridge (no messages)', () => {
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

    it('returns false when not isPending and no messages exist', () => {
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

  describe('context sync (setIsPending) — debounced clearing', () => {
    it('clears isPending after debounce when assistant reaches success', () => {
      const userMsg = createUIMessage({
        id: 'msg-1',
        order: 0,
        role: 'user',
        text: 'Hello',
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

      // Subscription delivers streaming → sets hasSeenActive
      const streamingMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        status: 'streaming',
      });
      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg, streamingMsg],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      // Generation completes
      const completedMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        text: 'Hi!',
        status: 'success',
      });
      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg, completedMsg],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      // Not cleared yet — debounce in progress
      expect(setIsPending).not.toHaveBeenCalledWith(false);

      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS);
      });

      expect(setIsPending).toHaveBeenCalledWith(false);
    });

    it('clears isPending after debounce when assistant reaches failed', () => {
      const userMsg = createUIMessage({
        id: 'msg-1',
        order: 0,
        role: 'user',
        text: 'Hello',
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

      // Streaming phase
      const streamingMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        status: 'streaming',
      });
      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg, streamingMsg],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      // Fails
      const failedMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        text: '',
        status: 'failed',
      });
      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg, failedMsg],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS);
      });

      expect(setIsPending).toHaveBeenCalledWith(false);
    });

    it('clears isPending after debounce when failed mid-tool-call', () => {
      const userMsg = createUIMessage({
        id: 'msg-1',
        order: 0,
        role: 'user',
        text: 'Hello',
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

      // Streaming phase
      const streamingMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        status: 'streaming',
      });
      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg, streamingMsg],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      // Fails mid-tool-call
      const failedToolMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        text: 'Let me create that for you.',
        status: 'failed',
        parts: [
          { type: 'text', text: 'Let me create that for you.' },
          { type: 'step-start' },
          {
            type: 'tool-excel',
            toolCallId: 'call-1',
            input: { operation: 'generate' },
            state: 'input-available',
          },
        ],
      });
      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg, failedToolMsg],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS);
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

      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS);
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

      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS);
      });

      expect(setIsPending).not.toHaveBeenCalled();
    });

    it('does not clear isPending when last message is user (waiting for AI)', () => {
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

      renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          uiMessages: [existingAssistant, userMsg],
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
        }),
      );

      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS);
      });

      expect(setIsPending).not.toHaveBeenCalledWith(false);
    });

    it('resets debounce when isMessageActive flickers back to true', () => {
      const userMsg = createUIMessage({
        id: 'msg-1',
        order: 0,
        role: 'user',
        text: 'Hello',
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

      // Streaming → sets hasSeenActive
      const streamingMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        status: 'streaming',
      });
      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg, streamingMsg],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      // Terminal briefly (subscription oscillation)
      const completedMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        status: 'success',
      });
      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg, completedMsg],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      // Advance only 1 second (half the debounce)
      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(setIsPending).not.toHaveBeenCalledWith(false);

      // Subscription flickers back to streaming
      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg, streamingMsg],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      // Back to terminal
      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg, completedMsg],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      // Full debounce period after flicker
      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS);
      });

      expect(setIsPending).toHaveBeenCalledWith(false);
    });

    it('does not clear isPending when subscription shows only old terminal assistants', () => {
      // Simulates subscription oscillation: only old messages visible,
      // new assistant not yet in the pagination window
      const oldAssistant = createUIMessage({
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

      const { rerender } = renderHook((props) => useChatLoadingState(props), {
        initialProps: {
          isPending: true,
          setIsPending,
          uiMessages: [oldAssistant, userMsg] as UIMessage[] | undefined,
          threadId: THREAD_A as string | undefined,
          pendingThreadId: THREAD_A as string | null,
        },
      });

      // Subscription oscillates back to just the old assistant
      rerender({
        isPending: true,
        setIsPending,
        uiMessages: [oldAssistant],
        threadId: THREAD_A,
        pendingThreadId: THREAD_A,
      });

      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS * 3);
      });

      // Should NOT clear — old assistant's creation time is before the baseline
      expect(setIsPending).not.toHaveBeenCalledWith(false);
    });
  });

  describe('safety timeout', () => {
    it('clears isPending after safety timeout even without activity', () => {
      renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          uiMessages: [],
          threadId: THREAD_A,
          pendingThreadId: THREAD_A,
        }),
      );

      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      expect(setIsPending).toHaveBeenCalledWith(false);
    });
  });

  describe('thread scoping', () => {
    it('clears isPending when pendingThreadId does not match threadId', () => {
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

    it('clears isPending on new-chat page when pendingThreadId is set (different thread pending)', () => {
      renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          uiMessages: undefined,
          threadId: undefined,
          pendingThreadId: THREAD_A,
        }),
      );

      expect(setIsPending).toHaveBeenCalledWith(false);
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

    it('does not clear isPending during new-chat transition when pendingThreadId is null', () => {
      renderHook(() =>
        useChatLoadingState({
          isPending: true,
          setIsPending,
          uiMessages: undefined,
          threadId: undefined,
          pendingThreadId: null,
        }),
      );

      expect(setIsPending).not.toHaveBeenCalled();
    });
  });

  describe('multi-step tool calls (some() scan)', () => {
    it('stays true when earlier assistant message is still pending but last is success', () => {
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
            createUIMessage({
              id: 'msg-2',
              order: 1,
              role: 'assistant',
              status: 'success',
            }),
          ],
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('stays true when earlier assistant message is streaming but last is success', () => {
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
            createUIMessage({
              id: 'msg-2',
              order: 1,
              role: 'assistant',
              status: 'success',
            }),
          ],
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('stays true when first message is success but second is streaming (tool-result retry)', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: false,
          setIsPending,
          uiMessages: [
            createUIMessage({
              id: 'msg-1',
              order: 0,
              role: 'user',
              text: 'Tell me about RAG',
            }),
            createUIMessage({
              id: 'msg-2',
              order: 1,
              role: 'assistant',
              status: 'success',
              text: 'Let me search...',
            }),
            createUIMessage({
              id: 'msg-3',
              order: 2,
              role: 'assistant',
              status: 'streaming',
              text: 'Based on the tool results...',
            }),
          ],
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('returns false only when all assistant messages are terminal', () => {
      const { result } = renderHook(() =>
        useChatLoadingState({
          isPending: false,
          setIsPending,
          uiMessages: [
            createUIMessage({
              id: 'msg-1',
              order: 0,
              role: 'user',
              text: 'Search my docs',
            }),
            createUIMessage({
              id: 'msg-2',
              order: 1,
              role: 'assistant',
              status: 'success',
              text: 'Let me search...',
            }),
            createUIMessage({
              id: 'msg-3',
              order: 2,
              role: 'assistant',
              status: 'success',
              text: 'Here are the results.',
            }),
          ],
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(false);
    });
  });
});
