// @vitest-environment jsdom
import type { UIMessage } from '@convex-dev/agent/react';

import { renderHook } from '@testing-library/react';
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

    it('returns true when last part is a tool part (unfinished tool turn)', () => {
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
              text: 'Let me create that for you.',
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
            }),
          ],
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(true);
    });

    it('returns false when tool parts exist but text part follows (completed tool turn)', () => {
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
              text: 'Here are the results...',
              parts: [
                { type: 'step-start' },
                {
                  type: 'tool-rag_search',
                  toolCallId: 'call-1',
                  input: { query: 'test' },
                  output: { results: [] },
                  state: 'output-available',
                },
                { type: 'text', text: 'Here are the results...' },
              ],
            }),
          ],
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(false);
    });

    it('returns true when tool message has text preamble before tool call', () => {
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
              text: 'I will create an Excel file for you.',
              parts: [
                {
                  type: 'text',
                  text: 'I will create an Excel file for you.',
                },
                { type: 'step-start' },
                {
                  type: 'tool-excel',
                  toolCallId: 'call-1',
                  input: { operation: 'generate' },
                  state: 'input-available',
                },
              ],
            }),
          ],
          threadId: THREAD_A,
          pendingThreadId: null,
        }),
      );

      expect(result.current.isLoading).toBe(true);
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

      expect(result.current.isLoading).toBe(false);
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

  describe('context sync (setIsPending)', () => {
    it('clears isPending when last assistant message reaches success', () => {
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

    it('clears isPending when last assistant message reaches failed', () => {
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

      expect(setIsPending).not.toHaveBeenCalledWith(false);
    });

    it('clears isPending on component remount with completed conversation', () => {
      const completedMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        text: 'Done',
        status: 'success',
      });

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
});
