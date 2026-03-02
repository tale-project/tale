import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { ChatMessage } from '../use-message-processing';

const mockPendingMessage = {
  current: null as
    | import('../../context/chat-layout-context').PendingMessage
    | null,
};
const mockSetPendingMessage = vi.fn();

vi.mock('../../context/chat-layout-context', () => ({
  useChatLayout: () => ({
    pendingMessage: mockPendingMessage.current,
    setPendingMessage: mockSetPendingMessage,
  }),
}));

const { usePendingMessages } = await import('../use-pending-messages');

beforeEach(() => {
  vi.clearAllMocks();
  mockPendingMessage.current = null;
});

describe('usePendingMessages', () => {
  it('returns real messages when no pending message', () => {
    const realMessages: ChatMessage[] = [
      {
        id: 'msg-1',
        key: 'msg-1',
        content: 'Hello',
        role: 'user',
        timestamp: new Date(),
      },
    ];

    const { result } = renderHook(() =>
      usePendingMessages({ threadId: 'thread-1', realMessages }),
    );

    expect(result.current).toEqual(realMessages);
  });

  it('shows optimistic message when pending and no real messages', () => {
    const ts = new Date('2024-01-01T00:00:00Z');
    mockPendingMessage.current = {
      content: 'Hi there',
      threadId: 'thread-1',
      timestamp: ts,
    };

    const { result } = renderHook(() =>
      usePendingMessages({ threadId: 'thread-1', realMessages: [] }),
    );

    expect(result.current).toHaveLength(1);
    expect(result.current[0].content).toBe('Hi there');
    expect(result.current[0].role).toBe('user');
    expect(result.current[0].timestamp).toBe(ts);
  });

  it('includes attachments in optimistic message', () => {
    const ts = new Date('2024-01-01T00:00:00Z');
    mockPendingMessage.current = {
      content: 'Check this image',
      threadId: 'thread-1',
      timestamp: ts,
      attachments: [
        {
          fileId: 'storage-id-1',
          fileName: 'photo.png',
          fileType: 'image/png',
          fileSize: 2048,
        },
        {
          fileId: 'storage-id-2',
          fileName: 'doc.pdf',
          fileType: 'application/pdf',
          fileSize: 4096,
        },
      ],
    };

    const { result } = renderHook(() =>
      usePendingMessages({ threadId: 'thread-1', realMessages: [] }),
    );

    expect(result.current).toHaveLength(1);
    expect(result.current[0].attachments).toHaveLength(2);
    expect(result.current[0].attachments?.[0]).toEqual(
      expect.objectContaining({
        fileId: 'storage-id-1',
        fileName: 'photo.png',
        fileType: 'image/png',
        fileSize: 2048,
      }),
    );
    expect(result.current[0].attachments?.[1]).toEqual(
      expect.objectContaining({
        fileId: 'storage-id-2',
        fileName: 'doc.pdf',
        fileType: 'application/pdf',
        fileSize: 4096,
      }),
    );
  });

  it('does not include attachments when pending message has none', () => {
    const ts = new Date('2024-01-01T00:00:00Z');
    mockPendingMessage.current = {
      content: 'Just text',
      threadId: 'thread-1',
      timestamp: ts,
    };

    const { result } = renderHook(() =>
      usePendingMessages({ threadId: 'thread-1', realMessages: [] }),
    );

    expect(result.current).toHaveLength(1);
    expect(result.current[0].attachments).toBeUndefined();
  });

  it('shows optimistic message when threadId is undefined (new chat)', () => {
    const ts = new Date('2024-01-01T00:00:00Z');
    mockPendingMessage.current = {
      content: 'New message',
      threadId: 'pending',
      timestamp: ts,
      attachments: [
        {
          fileId: 'storage-id-1',
          fileName: 'image.jpg',
          fileType: 'image/jpeg',
          fileSize: 1024,
        },
      ],
    };

    const { result } = renderHook(() =>
      usePendingMessages({ threadId: undefined, realMessages: [] }),
    );

    expect(result.current).toHaveLength(1);
    expect(result.current[0].content).toBe('New message');
    expect(result.current[0].attachments).toHaveLength(1);
  });

  it('returns real messages when pending exists with no lastMessageKey but real messages already loaded', () => {
    const existingMessages: ChatMessage[] = [
      {
        id: 'msg-1',
        key: 'msg-1',
        content: 'Hello',
        role: 'user',
        timestamp: new Date('2024-01-01T00:00:00Z'),
      },
      {
        id: 'msg-2',
        key: 'msg-2',
        content: 'Hi there!',
        role: 'assistant',
        timestamp: new Date('2024-01-01T00:00:01Z'),
      },
    ];

    mockPendingMessage.current = {
      content: 'Follow up question',
      threadId: 'thread-1',
      timestamp: new Date('2024-01-01T00:01:00Z'),
    };

    const { result } = renderHook(() =>
      usePendingMessages({
        threadId: 'thread-1',
        realMessages: existingMessages,
      }),
    );

    expect(result.current).toBe(existingMessages);
  });

  it('does not show pending for mismatched threadId', () => {
    const existingMessages: ChatMessage[] = [
      {
        id: 'msg-1',
        key: 'msg-1',
        content: 'Hello',
        role: 'user',
        timestamp: new Date('2024-01-01T00:00:00Z'),
      },
    ];

    mockPendingMessage.current = {
      content: 'Different thread',
      threadId: 'thread-2',
      timestamp: new Date('2024-01-01T00:01:00Z'),
    };

    const { result } = renderHook(() =>
      usePendingMessages({
        threadId: 'thread-1',
        realMessages: existingMessages,
      }),
    );

    expect(result.current).toBe(existingMessages);
    expect(mockSetPendingMessage).not.toHaveBeenCalled();
  });

  describe('new thread clearing', () => {
    it('clears pending message when first real message arrives for new thread', () => {
      mockPendingMessage.current = {
        content: 'First message',
        threadId: 'thread-1',
        timestamp: new Date('2024-01-01T00:00:00Z'),
      };

      const { rerender } = renderHook(
        ({ realMessages }) =>
          usePendingMessages({ threadId: 'thread-1', realMessages }),
        { initialProps: { realMessages: [] as ChatMessage[] } },
      );

      rerender({
        realMessages: [
          {
            id: 'msg-1',
            key: 'msg-1',
            content: 'First message',
            role: 'user',
            timestamp: new Date('2024-01-01T00:00:00Z'),
          },
        ],
      });

      expect(mockSetPendingMessage).toHaveBeenCalledWith(null);
    });
  });

  describe('existing thread optimistic messages', () => {
    it('appends optimistic message at end of existing thread while pending (lastMessageKey matches)', () => {
      const ts = new Date('2024-01-01T00:01:00Z');
      const existingMessages: ChatMessage[] = [
        {
          id: 'msg-1',
          key: 'msg-1',
          content: 'Hello',
          role: 'user',
          timestamp: new Date('2024-01-01T00:00:00Z'),
        },
        {
          id: 'msg-2',
          key: 'msg-2',
          content: 'Hi there!',
          role: 'assistant',
          timestamp: new Date('2024-01-01T00:00:01Z'),
        },
      ];

      mockPendingMessage.current = {
        content: 'Follow up question',
        threadId: 'thread-1',
        timestamp: ts,
        lastMessageKey: 'msg-2',
      };

      const { result } = renderHook(() =>
        usePendingMessages({
          threadId: 'thread-1',
          realMessages: existingMessages,
        }),
      );

      expect(result.current).toHaveLength(3);
      expect(result.current[0]).toBe(existingMessages[0]);
      expect(result.current[1]).toBe(existingMessages[1]);
      expect(result.current[2].content).toBe('Follow up question');
      expect(result.current[2].role).toBe('user');
      expect(result.current[2].id).toBe(`pending-${ts.getTime()}`);
    });

    it('removes optimistic when real message arrives (last key differs from lastMessageKey)', () => {
      const existingMessages: ChatMessage[] = [
        {
          id: 'msg-1',
          key: 'msg-1',
          content: 'Hello',
          role: 'user',
          timestamp: new Date('2024-01-01T00:00:00Z'),
        },
        {
          id: 'msg-2',
          key: 'msg-2',
          content: 'Hi there!',
          role: 'assistant',
          timestamp: new Date('2024-01-01T00:00:01Z'),
        },
      ];

      mockPendingMessage.current = {
        content: 'Follow up question',
        threadId: 'thread-1',
        timestamp: new Date('2024-01-01T00:01:00Z'),
        lastMessageKey: 'msg-2',
      };

      const { result, rerender } = renderHook(
        ({ realMessages }) =>
          usePendingMessages({ threadId: 'thread-1', realMessages }),
        { initialProps: { realMessages: existingMessages } },
      );

      expect(result.current).toHaveLength(3);

      const updatedMessages: ChatMessage[] = [
        ...existingMessages,
        {
          id: 'msg-3',
          key: 'msg-3',
          content: 'Follow up question',
          role: 'user',
          timestamp: new Date('2024-01-01T00:01:00Z'),
        },
      ];

      rerender({ realMessages: updatedMessages });

      expect(mockSetPendingMessage).toHaveBeenCalledWith(null);
    });

    it('does not show duplicate: useMemo atomically switches from optimistic to real', () => {
      const existingMessages: ChatMessage[] = [
        {
          id: 'msg-1',
          key: 'msg-1',
          content: 'Hello',
          role: 'user',
          timestamp: new Date('2024-01-01T00:00:00Z'),
        },
        {
          id: 'msg-2',
          key: 'msg-2',
          content: 'Hi there!',
          role: 'assistant',
          timestamp: new Date('2024-01-01T00:00:01Z'),
        },
      ];

      mockPendingMessage.current = {
        content: 'Follow up question',
        threadId: 'thread-1',
        timestamp: new Date('2024-01-01T00:01:00Z'),
        lastMessageKey: 'msg-2',
      };

      const { result, rerender } = renderHook(
        ({ realMessages }) =>
          usePendingMessages({ threadId: 'thread-1', realMessages }),
        { initialProps: { realMessages: existingMessages } },
      );

      expect(result.current).toHaveLength(3);
      expect(result.current[2].content).toBe('Follow up question');
      expect(result.current[2].id).toMatch(/^pending-/);

      const updatedMessages: ChatMessage[] = [
        ...existingMessages,
        {
          id: 'msg-3',
          key: 'msg-3',
          content: 'Follow up question',
          role: 'user',
          timestamp: new Date('2024-01-01T00:01:00Z'),
        },
      ];

      rerender({ realMessages: updatedMessages });

      expect(result.current).toHaveLength(3);
      expect(result.current[2].id).toBe('msg-3');
      expect(result.current[2].key).toBe('msg-3');
      expect(result.current.every((m) => !m.id.startsWith('pending-'))).toBe(
        true,
      );
    });

    it('pagination (loadMore prepends) does not clear optimistic (last key unchanged)', () => {
      const existingMessages: ChatMessage[] = [
        {
          id: 'msg-5',
          key: 'msg-5',
          content: 'Recent message',
          role: 'user',
          timestamp: new Date('2024-01-01T00:00:05Z'),
        },
        {
          id: 'msg-6',
          key: 'msg-6',
          content: 'Latest reply',
          role: 'assistant',
          timestamp: new Date('2024-01-01T00:00:06Z'),
        },
      ];

      mockPendingMessage.current = {
        content: 'New question',
        threadId: 'thread-1',
        timestamp: new Date('2024-01-01T00:01:00Z'),
        lastMessageKey: 'msg-6',
      };

      const { result, rerender } = renderHook(
        ({ realMessages }) =>
          usePendingMessages({ threadId: 'thread-1', realMessages }),
        { initialProps: { realMessages: existingMessages } },
      );

      expect(result.current).toHaveLength(3);
      expect(result.current[2].content).toBe('New question');

      const withOlderMessages: ChatMessage[] = [
        {
          id: 'msg-3',
          key: 'msg-3',
          content: 'Older message',
          role: 'user',
          timestamp: new Date('2024-01-01T00:00:03Z'),
        },
        {
          id: 'msg-4',
          key: 'msg-4',
          content: 'Older reply',
          role: 'assistant',
          timestamp: new Date('2024-01-01T00:00:04Z'),
        },
        ...existingMessages,
      ];

      rerender({ realMessages: withOlderMessages });

      expect(result.current).toHaveLength(5);
      expect(result.current[4].content).toBe('New question');
      expect(result.current[4].id).toMatch(/^pending-/);
      expect(mockSetPendingMessage).not.toHaveBeenCalled();
    });

    it('does not show optimistic for mismatched threadId on existing thread', () => {
      const existingMessages: ChatMessage[] = [
        {
          id: 'msg-1',
          key: 'msg-1',
          content: 'Hello',
          role: 'user',
          timestamp: new Date('2024-01-01T00:00:00Z'),
        },
      ];

      mockPendingMessage.current = {
        content: 'Wrong thread message',
        threadId: 'thread-2',
        timestamp: new Date('2024-01-01T00:01:00Z'),
        lastMessageKey: 'msg-1',
      };

      const { result } = renderHook(() =>
        usePendingMessages({
          threadId: 'thread-1',
          realMessages: existingMessages,
        }),
      );

      expect(result.current).toBe(existingMessages);
      expect(result.current).toHaveLength(1);
    });

    it('does not clear pending message for wrong thread when navigating', () => {
      const thread1Messages: ChatMessage[] = [
        {
          id: 'msg-1',
          key: 'msg-1',
          content: 'Hello in thread 1',
          role: 'user',
          timestamp: new Date('2024-01-01T00:00:00Z'),
        },
      ];

      mockPendingMessage.current = {
        content: 'Message for thread 2',
        threadId: 'thread-2',
        timestamp: new Date('2024-01-01T00:01:00Z'),
        lastMessageKey: 'msg-10',
      };

      renderHook(() =>
        usePendingMessages({
          threadId: 'thread-1',
          realMessages: thread1Messages,
        }),
      );

      expect(mockSetPendingMessage).not.toHaveBeenCalled();
    });

    it('preserves existing behavior for new threads (realMessages empty, no lastMessageKey)', () => {
      const ts = new Date('2024-01-01T00:00:00Z');
      mockPendingMessage.current = {
        content: 'Brand new thread message',
        threadId: 'thread-1',
        timestamp: ts,
      };

      const { result, rerender } = renderHook(
        ({ realMessages }) =>
          usePendingMessages({ threadId: 'thread-1', realMessages }),
        { initialProps: { realMessages: [] as ChatMessage[] } },
      );

      expect(result.current).toHaveLength(1);
      expect(result.current[0].content).toBe('Brand new thread message');
      expect(result.current[0].role).toBe('user');

      rerender({
        realMessages: [
          {
            id: 'msg-1',
            key: 'msg-1',
            content: 'Brand new thread message',
            role: 'user',
            timestamp: ts,
          },
        ],
      });

      expect(mockSetPendingMessage).toHaveBeenCalledWith(null);
    });

    it('clears pending message via setPendingMessage(null) when real arrives', () => {
      const existingMessages: ChatMessage[] = [
        {
          id: 'msg-1',
          key: 'msg-1',
          content: 'Hello',
          role: 'user',
          timestamp: new Date('2024-01-01T00:00:00Z'),
        },
      ];

      mockPendingMessage.current = {
        content: 'Follow up',
        threadId: 'thread-1',
        timestamp: new Date('2024-01-01T00:01:00Z'),
        lastMessageKey: 'msg-1',
      };

      const { rerender } = renderHook(
        ({ realMessages }) =>
          usePendingMessages({ threadId: 'thread-1', realMessages }),
        { initialProps: { realMessages: existingMessages } },
      );

      expect(mockSetPendingMessage).not.toHaveBeenCalled();

      const updatedMessages: ChatMessage[] = [
        ...existingMessages,
        {
          id: 'msg-2',
          key: 'msg-2',
          content: 'Follow up',
          role: 'user',
          timestamp: new Date('2024-01-01T00:01:00Z'),
        },
        {
          id: 'msg-3',
          key: 'msg-3',
          content: 'Here is my response',
          role: 'assistant',
          timestamp: new Date('2024-01-01T00:01:01Z'),
        },
      ];

      rerender({ realMessages: updatedMessages });

      expect(mockSetPendingMessage).toHaveBeenCalledTimes(1);
      expect(mockSetPendingMessage).toHaveBeenCalledWith(null);
    });
  });
});
