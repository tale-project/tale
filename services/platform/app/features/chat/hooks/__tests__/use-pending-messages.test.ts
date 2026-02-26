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

  it('returns real messages when pending exists but real messages already loaded', () => {
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

      // Real message arrives
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
});
