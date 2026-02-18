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

  it('clears pending when streaming message appears', () => {
    const streamingMessage = createUIMessage({
      id: 'msg-1',
      order: 0,
      role: 'assistant',
      status: 'streaming',
    });

    renderHook(() =>
      useChatPendingState({
        isPending: true,
        setIsPending,
        streamingMessage,
        uiMessages: [streamingMessage],
      }),
    );

    expect(setIsPending).toHaveBeenCalledWith(false);
  });

  it('does not clear pending when no streaming message exists', () => {
    renderHook(() =>
      useChatPendingState({
        isPending: true,
        setIsPending,
        streamingMessage: undefined,
        uiMessages: [],
      }),
    );

    expect(setIsPending).not.toHaveBeenCalled();
  });

  it('clears pending via fallback when completed assistant message appears', () => {
    const userMsg = createUIMessage({
      id: 'msg-1',
      order: 0,
      role: 'user',
      text: 'Hello',
    });
    const assistantMsg = createUIMessage({
      id: 'msg-2',
      order: 1,
      role: 'assistant',
      text: 'Hi!',
      status: 'success',
    });

    // First render: set pending with count tracking
    const { rerender } = renderHook((props) => useChatPendingState(props), {
      initialProps: {
        isPending: true,
        setIsPending,
        streamingMessage: undefined as UIMessage | undefined,
        uiMessages: [userMsg] as UIMessage[] | undefined,
      },
    });

    // Use setPendingWithCount to store current assistant count
    // The hook's effect runs and sees no streaming message, no new assistant messages
    expect(setIsPending).not.toHaveBeenCalled();

    // Now rerender with a completed assistant message
    rerender({
      isPending: true,
      setIsPending,
      streamingMessage: undefined,
      uiMessages: [userMsg, assistantMsg],
    });

    expect(setIsPending).toHaveBeenCalledWith(false);
  });

  it('does not clear pending for human input response when only fallback condition met', () => {
    const userMsg = createUIMessage({
      id: 'msg-1',
      order: 0,
      role: 'user',
      text: 'Hello',
    });
    const assistantMsg = createUIMessage({
      id: 'msg-2',
      order: 1,
      role: 'assistant',
      text: 'Done',
      status: 'success',
    });

    const { result, rerender } = renderHook(
      (props) => useChatPendingState(props),
      {
        initialProps: {
          isPending: false as boolean,
          setIsPending,
          streamingMessage: undefined as UIMessage | undefined,
          uiMessages: [userMsg, assistantMsg] as UIMessage[] | undefined,
        },
      },
    );

    // Activate pending as human input response
    act(() => {
      result.current.setPendingWithCount(true, true);
    });

    // Rerender with pending=true (simulating context update)
    rerender({
      isPending: true,
      setIsPending,
      streamingMessage: undefined,
      uiMessages: [userMsg, assistantMsg],
    });

    // Should NOT clear via fallback because it's a human input response
    expect(setIsPending).not.toHaveBeenCalledWith(false);
  });

  it('clears human input pending when streaming starts', () => {
    const streamingMsg = createUIMessage({
      id: 'msg-3',
      order: 2,
      role: 'assistant',
      status: 'streaming',
    });

    const { result, rerender } = renderHook(
      (props) => useChatPendingState(props),
      {
        initialProps: {
          isPending: false as boolean,
          setIsPending,
          streamingMessage: undefined as UIMessage | undefined,
          uiMessages: [] as UIMessage[] | undefined,
        },
      },
    );

    // Set as human input pending
    act(() => {
      result.current.setPendingWithCount(true, true);
    });

    // Streaming starts
    rerender({
      isPending: true,
      setIsPending,
      streamingMessage: streamingMsg,
      uiMessages: [streamingMsg],
    });

    expect(setIsPending).toHaveBeenCalledWith(false);
  });
});
