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

import {
  useMessageProcessing,
  stripInternalFileReferences,
  extractFileAttachments,
} from '../use-message-processing';

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

    it('returns true when there are only user messages (waiting for assistant)', () => {
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
      expect(result.current.hasIncompleteAssistantMessage).toBe(true);
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

  describe('sticky isStreaming', () => {
    it('keeps isStreaming true when status transitions from streaming to pending', () => {
      const msgKey = 'msg-2';

      // First render: message is streaming
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Hi',
          }),
          createUIMessage({
            id: msgKey,
            order: 1,
            role: 'assistant',
            text: 'Hello...',
            status: 'streaming',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result, rerender } = renderHook(() =>
        useMessageProcessing('thread-1'),
      );
      expect(
        result.current.messages.find((m) => m.key === msgKey)?.isStreaming,
      ).toBe(true);

      // Second render: status falls back to pending (reconnection)
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Hi',
          }),
          createUIMessage({
            id: msgKey,
            order: 1,
            role: 'assistant',
            text: '',
            status: 'pending',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      rerender();
      expect(
        result.current.messages.find((m) => m.key === msgKey)?.isStreaming,
      ).toBe(true);
    });

    it('sets isStreaming false when status reaches success', () => {
      const msgKey = 'msg-2';

      // First render: streaming
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: msgKey,
            order: 1,
            role: 'assistant',
            text: 'Hello',
            status: 'streaming',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result, rerender } = renderHook(() =>
        useMessageProcessing('thread-1'),
      );
      expect(
        result.current.messages.find((m) => m.key === msgKey)?.isStreaming,
      ).toBe(true);

      // Second render: completed
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: msgKey,
            order: 1,
            role: 'assistant',
            text: 'Hello world!',
            status: 'success',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      rerender();
      expect(
        result.current.messages.find((m) => m.key === msgKey)?.isStreaming,
      ).toBe(false);
    });

    it('does not treat a never-streaming pending message as streaming', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Hi',
          }),
          createUIMessage({
            id: 'msg-2',
            order: 1,
            role: 'assistant',
            text: '',
            status: 'pending',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(
        result.current.messages.find((m) => m.key === 'msg-2')?.isStreaming,
      ).toBe(false);
    });
  });

  describe('stripInternalFileReferences', () => {
    it('removes the attached files marker', () => {
      const input =
        'Hello\n\n[ATTACHED FILES - Pre-analysis was not available. Use your tools to process these files.]';
      expect(stripInternalFileReferences(input)).toBe('Hello');
    });

    it('removes fileId references', () => {
      const input =
        'Hello\n📎 **image.png** (image/png, fileId: kg24f801scvhvxnx320zcd9rcd81g8aj)';
      expect(stripInternalFileReferences(input)).toBe('Hello');
    });

    it('removes both marker and multiple file references', () => {
      const input = [
        'What is this?',
        '',
        '[ATTACHED FILES - Pre-analysis was not available. Use your tools to process these files.]',
        '📎 **photo.jpg** (image/jpeg, fileId: abc123def456)',
        '📎 **doc.pdf** (application/pdf, fileId: xyz789)',
      ].join('\n');
      expect(stripInternalFileReferences(input)).toBe('What is this?');
    });

    it('returns text unchanged when no internal references exist', () => {
      const input = 'Just a normal message with no file references';
      expect(stripInternalFileReferences(input)).toBe(input);
    });

    it('handles empty string', () => {
      expect(stripInternalFileReferences('')).toBe('');
    });

    it('strips fileId marker but preserves image markdown for renderer', () => {
      const input =
        '![photo.jpg](https://example.com/img.jpg)\n*(fileId: kg24f801scvhvxnx320zcd9rcd81g8aj)*';
      expect(stripInternalFileReferences(input)).toBe(
        '![photo.jpg](https://example.com/img.jpg)',
      );
    });

    it('strips fileId marker but preserves document link markdown', () => {
      const input =
        '📄 [report.pdf](https://example.com/file) (application/pdf, 1.2 MB)\n*(fileId: abc123def456)*';
      expect(stripInternalFileReferences(input)).toBe(
        '📄 [report.pdf](https://example.com/file) (application/pdf, 1.2 MB)',
      );
    });

    it('preserves user text and image markdown while stripping fileId', () => {
      const input = [
        'What is this image?',
        '',
        '![photo.jpg](https://example.com/img.jpg)',
        '*(fileId: abc123)*',
      ].join('\n');
      expect(stripInternalFileReferences(input)).toBe(
        'What is this image?\n\n![photo.jpg](https://example.com/img.jpg)',
      );
    });

    it('strips fileId markers from multiple attachments but preserves markdown', () => {
      const input = [
        'Please review',
        '',
        '📄 [report.pdf](https://example.com/pdf) (application/pdf, 2 MB)',
        '*(fileId: pdf123)*',
        '',
        '📄 [notes.txt](https://example.com/txt) (512 B)',
        '*(fileId: txt456)*',
      ].join('\n');
      expect(stripInternalFileReferences(input)).toBe(
        [
          'Please review',
          '',
          '📄 [report.pdf](https://example.com/pdf) (application/pdf, 2 MB)',
          '',
          '📄 [notes.txt](https://example.com/txt) (512 B)',
        ].join('\n'),
      );
    });

    it('strips entire enriched attachment block (markdown line + marker)', () => {
      const input =
        '![photo.jpg](https://example.com/img.jpg)\n*(fileId: abc123 | fileName: photo.jpg | fileType: image/jpeg | fileSize: 54321)*';
      expect(stripInternalFileReferences(input)).toBe('');
    });

    it('strips multiple enriched blocks from mixed attachment types', () => {
      const input = [
        'Check these files',
        '',
        '📄 [report.pdf](https://example.com/pdf) (application/pdf, 2 MB)',
        '*(fileId: pdf123 | fileName: report.pdf | fileType: application/pdf | fileSize: 2097152)*',
        '',
        '![screenshot.png](https://example.com/img.png)',
        '*(fileId: img456 | fileName: screenshot.png | fileType: image/png | fileSize: 102400)*',
      ].join('\n');
      expect(stripInternalFileReferences(input)).toBe('Check these files');
    });
  });

  describe('extractFileAttachments', () => {
    it('extracts a single image attachment', () => {
      const input =
        '![photo.jpg](https://example.com/img.jpg)\n*(fileId: abc123def456 | fileName: photo.jpg | fileType: image/jpeg | fileSize: 54321)*';
      const result = extractFileAttachments(input);
      expect(result).toEqual([
        {
          fileId: 'abc123def456',
          fileName: 'photo.jpg',
          fileType: 'image/jpeg',
          fileSize: 54321,
        },
      ]);
    });

    it('extracts multiple attachments of mixed types', () => {
      const input = [
        'Please review',
        '',
        '📎 [report.pdf](https://example.com/pdf) (application/pdf, 2 MB)',
        '*(fileId: pdf123 | fileName: report.pdf | fileType: application/pdf | fileSize: 2097152)*',
        '',
        '📄 [notes.txt](https://example.com/txt) (512 B)',
        '*(fileId: txt456 | fileName: notes.txt | fileType: text/plain | fileSize: 512)*',
        '',
        '![screenshot.png](https://example.com/img.png)',
        '*(fileId: img789 | fileName: screenshot.png | fileType: image/png | fileSize: 102400)*',
      ].join('\n');
      const result = extractFileAttachments(input);
      expect(result).toEqual([
        {
          fileId: 'pdf123',
          fileName: 'report.pdf',
          fileType: 'application/pdf',
          fileSize: 2097152,
        },
        {
          fileId: 'txt456',
          fileName: 'notes.txt',
          fileType: 'text/plain',
          fileSize: 512,
        },
        {
          fileId: 'img789',
          fileName: 'screenshot.png',
          fileType: 'image/png',
          fileSize: 102400,
        },
      ]);
    });

    it('returns empty array when no enriched markers exist', () => {
      const input = 'Just a normal message with no attachments';
      expect(extractFileAttachments(input)).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(extractFileAttachments('')).toEqual([]);
    });

    it('ignores legacy fileId-only markers', () => {
      const input =
        '![photo.jpg](https://example.com/img.jpg)\n*(fileId: abc123)*';
      expect(extractFileAttachments(input)).toEqual([]);
    });
  });
});
