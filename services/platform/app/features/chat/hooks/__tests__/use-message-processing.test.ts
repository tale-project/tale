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

vi.mock('../use-stream-buffer', () => ({}));

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

  describe('activeMessage', () => {
    it('returns streaming message when available', () => {
      const streamingMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        text: 'Hello...',
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
      expect(result.current.activeMessage).toBe(streamingMsg);
    });

    it('returns pending message when no streaming message exists', () => {
      const pendingMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        text: '',
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
      expect(result.current.activeMessage).toBe(pendingMsg);
    });

    it('prefers streaming over pending when both exist', () => {
      const pendingMsg = createUIMessage({
        id: 'msg-2',
        order: 1,
        role: 'assistant',
        text: '',
        status: 'pending',
      });
      const streamingMsg = createUIMessage({
        id: 'msg-3',
        order: 2,
        role: 'assistant',
        text: 'Results...',
        status: 'streaming',
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
          streamingMsg,
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.activeMessage).toBe(pendingMsg);
      expect(result.current.streamingMessage).toBeUndefined();
      expect(result.current.pendingToolResponse).toBe(pendingMsg);
    });

    it('returns undefined when all messages are terminal', () => {
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
            text: 'Done',
            status: 'success',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.activeMessage).toBeUndefined();
    });
  });

  describe('hasActiveTools with pending messages', () => {
    it('detects active tools on pending message', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Search',
          }),
          createUIMessage({
            id: 'msg-2',
            order: 1,
            role: 'assistant',
            text: '',
            status: 'pending',
            parts: [
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
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.hasActiveTools).toBe(true);
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

    it('keeps isStreaming true for one cycle when empty-streaming message gets content at terminal status', () => {
      const msgKey = 'msg-2';

      // First render: streaming with no text (tool turn phase)
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Search my docs',
          }),
          createUIMessage({
            id: msgKey,
            order: 1,
            role: 'assistant',
            text: '',
            status: 'streaming',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result, rerender } = renderHook(() =>
        useMessageProcessing('thread-1'),
      );
      // Empty streaming message: isStreaming true but content is empty
      const emptyMsg = result.current.messages.find((m) => m.key === msgKey);
      expect(emptyMsg?.isStreaming).toBe(true);
      expect(emptyMsg?.content).toBe('');

      // Second render: jumps to success with full text (SDK batched update)
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Search my docs',
          }),
          createUIMessage({
            id: msgKey,
            order: 1,
            role: 'assistant',
            text: 'Here are the search results for your documents...',
            status: 'success',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      rerender();
      // Should keep isStreaming true so TypewriterText can mount and animate
      const filledMsg = result.current.messages.find((m) => m.key === msgKey);
      expect(filledMsg?.isStreaming).toBe(true);
      expect(filledMsg?.content).toBe(
        'Here are the search results for your documents...',
      );

      // Third render: same data (new reference to trigger useMemo), isStreaming should now be false
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Search my docs',
          }),
          createUIMessage({
            id: msgKey,
            order: 1,
            role: 'assistant',
            text: 'Here are the search results for your documents...',
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

    it('does not extend isStreaming when message had text during streaming', () => {
      const msgKey = 'msg-2';

      // First render: streaming with text (normal text streaming)
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
            text: 'Hello there! How can I help?',
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
            id: 'msg-1',
            order: 0,
            role: 'user',
            text: 'Hi',
          }),
          createUIMessage({
            id: msgKey,
            order: 1,
            role: 'assistant',
            text: 'Hello there! How can I help you today?',
            status: 'success',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      rerender();
      // Should be false immediately — TypewriterText was already mounted
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

  describe('isAborted flag', () => {
    it('sets isAborted true when failed message has empty text', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
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
            text: '',
            status: 'failed',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      const abortedMsg = result.current.messages.find((m) => m.key === 'msg-2');
      expect(abortedMsg?.isAborted).toBe(true);
      expect(abortedMsg?.content).toBe('');
    });

    it('sets isAborted true when failed message has whitespace-only text', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'assistant',
            text: '   \n  ',
            status: 'failed',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.messages[0]?.isAborted).toBe(true);
    });

    it('does not set isAborted for failed messages with real content', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'assistant',
            text: 'The history of computing begins with...',
            status: 'failed',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.messages[0]?.isAborted).toBe(false);
    });

    it('does not set isAborted for successful messages', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'assistant',
            text: 'Done!',
            status: 'success',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.messages[0]?.isAborted).toBe(false);
    });

    it('sets isAborted true for failed messages with null text', () => {
      mockUseUIMessages.mockReturnValue({
        results: [
          createUIMessage({
            id: 'msg-1',
            order: 0,
            role: 'assistant',
            text: null,
            status: 'failed',
          }),
        ],
        loadMore: mockLoadMore,
        status: 'Exhausted',
      } as unknown as ReturnType<typeof useUIMessages>);

      const { result } = renderHook(() => useMessageProcessing('thread-1'));
      expect(result.current.messages[0]?.isAborted).toBe(true);
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
