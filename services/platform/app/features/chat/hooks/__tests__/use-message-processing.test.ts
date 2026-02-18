import type { UIMessage } from '@convex-dev/agent/react';

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoadMore = vi.fn();

vi.mock('@convex-dev/agent/react', () => ({
  useUIMessages: vi.fn(() => ({
    results: undefined,
    loadMore: mockLoadMore,
    status: 'Exhausted',
  })),
}));

import { useUIMessages } from '@convex-dev/agent/react';

import { useMessageProcessing } from '../use-message-processing';

const mockUseUIMessages = vi.mocked(useUIMessages);

function createUIMessage(
  overrides: Partial<UIMessage> & { id: string; order: number },
): UIMessage {
  return {
    key: overrides.id,
    role: 'assistant',
    text: '',
    _creationTime: Date.now(),
    status: 'success',
    stepOrder: 0,
    parts: [],
    ...overrides,
  } satisfies UIMessage;
}

describe('useMessageProcessing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('hasIncompleteAssistantMessage', () => {
    it('returns false when there are no messages', () => {
      mockUseUIMessages.mockReturnValue({
        results: undefined,
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.hasIncompleteAssistantMessage).toBe(false);
    });

    it('returns false when there are no assistant messages', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Hello',
            status: 'success',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.hasIncompleteAssistantMessage).toBe(false);
    });

    it('returns false when last assistant message has status "success"', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Hello',
          }),
          createUIMessage({
            id: 'msg-2',
            order: 1,
            role: 'assistant',
            text: 'Hi!',
            status: 'success',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.hasIncompleteAssistantMessage).toBe(false);
    });

    it('returns false when last assistant message has status "failed"', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Hello',
          }),
          createUIMessage({
            id: 'msg-2',
            order: 1,
            role: 'assistant',
            text: 'Error occurred',
            status: 'failed',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.hasIncompleteAssistantMessage).toBe(false);
    });

    it('returns true when last assistant message has status "streaming"', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Hello',
          }),
          createUIMessage({
            id: 'msg-2',
            order: 1,
            role: 'assistant',
            text: '',
            status: 'streaming',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.hasIncompleteAssistantMessage).toBe(true);
    });

    it('returns true when last assistant message has status "pending" (waiting for tool results)', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Search for something',
          }),
          createUIMessage({
            id: 'msg-2',
            order: 1,
            role: 'assistant',
            text: 'Let me search...',
            status: 'pending',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.hasIncompleteAssistantMessage).toBe(true);
    });

    it('checks the last assistant message, not earlier ones', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'First question',
          }),
          createUIMessage({
            id: 'msg-2',
            order: 1,
            role: 'assistant',
            text: 'First answer',
            status: 'success',
          }),
          createUIMessage({
            id: 'msg-3',
            order: 2,
            role: 'user',
            text: 'Second question',
          }),
          createUIMessage({
            id: 'msg-4',
            order: 3,
            role: 'assistant',
            text: '',
            status: 'pending',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.hasIncompleteAssistantMessage).toBe(true);
    });

    it('returns false when last assistant message completed even if earlier ones were pending', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Hello',
          }),
          createUIMessage({
            id: 'msg-2',
            order: 1,
            role: 'assistant',
            text: 'Done!',
            status: 'success',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.hasIncompleteAssistantMessage).toBe(false);
    });
  });

  describe('streamingMessage', () => {
    it('returns undefined when no messages are streaming', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'assistant',
            text: 'Done',
            status: 'success',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.streamingMessage).toBeUndefined();
    });

    it('returns the streaming assistant message', () => {
      const streamingMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        text: 'Thinking...',
        status: 'streaming',
      });

      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Hi',
          }),
          streamingMsg,
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.streamingMessage).toBe(streamingMsg);
    });
  });

  describe('pendingToolResponse', () => {
    it('returns undefined when no pending tool responses', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'assistant',
            status: 'success',
            text: 'Done',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.pendingToolResponse).toBeUndefined();
    });

    it('returns the pending assistant message', () => {
      const pendingMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        text: 'Searching...',
        status: 'pending',
      });

      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Search',
          }),
          pendingMsg,
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.pendingToolResponse).toBe(pendingMsg);
    });
  });
});
