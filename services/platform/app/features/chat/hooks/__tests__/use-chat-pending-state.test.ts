import type { UIMessage } from '@convex-dev/agent/react';

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useChatPendingState } from '../use-chat-pending-state';

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

describe('useChatPendingState', () => {
  let setIsPending: (pending: boolean) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    setIsPending = vi.fn<(pending: boolean) => void>();
  });

  it('does not clear pending when no messages exist', () => {
    renderHook(() =>
      useChatPendingState({
        isPending: true,
        setIsPending,
        uiMessages: [],
      }),
    );

    expect(setIsPending).not.toHaveBeenCalled();
  });

  it('does not clear pending while waiting for new assistant message', () => {
    const userMsg = createUIMessage({
      id: 'msg-1',
      order: 0,
      role: 'user',
      text: 'Hello',
    });

    renderHook(() =>
      useChatPendingState({
        isPending: true,
        setIsPending,
        uiMessages: [userMsg],
      }),
    );

    expect(setIsPending).not.toHaveBeenCalled();
  });

  it('does not clear pending when assistant message is still streaming', () => {
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
      text: 'thinking...',
    });

    const { rerender } = renderHook((props) => useChatPendingState(props), {
      initialProps: {
        isPending: true,
        setIsPending,
        uiMessages: [userMsg] as UIMessage[] | undefined,
      },
    });

    rerender({
      isPending: true,
      setIsPending,
      uiMessages: [userMsg, streamingMsg],
    });

    expect(setIsPending).not.toHaveBeenCalledWith(false);
  });

  it('does not clear pending when assistant message has pending status (tool call)', () => {
    const userMsg = createUIMessage({
      id: 'msg-1',
      order: 0,
      role: 'user',
      text: 'Hello',
    });
    const pendingMsg = createUIMessage({
      id: 'msg-2',
      order: 1,
      role: 'assistant',
      status: 'pending',
      text: 'Let me check...',
    });

    const { rerender } = renderHook((props) => useChatPendingState(props), {
      initialProps: {
        isPending: true,
        setIsPending,
        uiMessages: [userMsg] as UIMessage[] | undefined,
      },
    });

    rerender({
      isPending: true,
      setIsPending,
      uiMessages: [userMsg, pendingMsg],
    });

    expect(setIsPending).not.toHaveBeenCalledWith(false);
  });

  it('clears pending when new assistant message reaches success', () => {
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

    const { rerender } = renderHook((props) => useChatPendingState(props), {
      initialProps: {
        isPending: true,
        setIsPending,
        uiMessages: [userMsg] as UIMessage[] | undefined,
      },
    });

    rerender({
      isPending: true,
      setIsPending,
      uiMessages: [userMsg, completedMsg],
    });

    expect(setIsPending).toHaveBeenCalledWith(false);
  });

  it('clears pending when new assistant message reaches failed', () => {
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

    const { rerender } = renderHook((props) => useChatPendingState(props), {
      initialProps: {
        isPending: true,
        setIsPending,
        uiMessages: [userMsg] as UIMessage[] | undefined,
      },
    });

    rerender({
      isPending: true,
      setIsPending,
      uiMessages: [userMsg, failedMsg],
    });

    expect(setIsPending).toHaveBeenCalledWith(false);
  });

  it('does not clear pending for pre-existing terminal messages when using setPendingWithCount', () => {
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

    // First render: not pending, existing conversation
    const { result, rerender } = renderHook(
      (props) => useChatPendingState(props),
      {
        initialProps: {
          isPending: false as boolean,
          setIsPending,
          uiMessages: messages,
        },
      },
    );

    // User sends a follow-up — setPendingWithCount tracks current assistant count (1)
    act(() => {
      result.current.setPendingWithCount(true);
    });

    rerender({
      isPending: true,
      setIsPending,
      uiMessages: messages,
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
    // assistantCountRef starts null, gets initialized to max(0, length-1) = 0
    // Then length (1) > 0 → checks terminal → all success → clears
    renderHook(() =>
      useChatPendingState({
        isPending: true,
        setIsPending,
        uiMessages: [completedMsg],
      }),
    );

    expect(setIsPending).toHaveBeenCalledWith(false);
  });
});
