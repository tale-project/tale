import { useMemo } from 'react';
import { useUIMessages, type UIMessage } from '@convex-dev/agent/react';
import { api } from '@/convex/_generated/api';
import type { FileAttachment } from '../types';

interface FilePart {
  type: 'file';
  mediaType: string;
  filename?: string;
  url: string;
}

export interface ChatMessage {
  id: string;
  key: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  attachments?: FileAttachment[];
  fileParts?: FilePart[];
  _creationTime?: number;
  isStreaming?: boolean;
}

interface UseMessageProcessingResult {
  messages: ChatMessage[];
  uiMessages: UIMessage[] | undefined;
  loadMore: (numItems: number) => void;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  streamingMessage: UIMessage | undefined;
  hasActiveTools: boolean;
}

/**
 * Hook to fetch and process thread messages.
 * Handles UIMessage → ChatMessage conversion, pagination, and streaming state.
 */
export function useMessageProcessing(
  threadId: string | undefined,
): UseMessageProcessingResult {
  const {
    results: uiMessages,
    loadMore,
    status: paginationStatus,
  } = useUIMessages(
    api.threads.queries.getThreadMessagesStreaming,
    threadId ? { threadId } : 'skip',
    { initialNumItems: 20, stream: true },
  );

  const canLoadMore = paginationStatus === 'CanLoadMore';
  const isLoadingMore = paginationStatus === 'LoadingMore';

  // Convert UIMessage to ChatMessage format
  // Handles orphan filtering (Issue #184) and file part extraction
  const messages: ChatMessage[] = useMemo(() => {
    if (!uiMessages?.length) return [];

    const userMessages = uiMessages.filter((m) => m.role === 'user');
    const minUserOrder =
      userMessages.length > 0
        ? Math.min(...userMessages.map((m) => m.order))
        : 0;

    return uiMessages
      .filter((m) => {
        if (m.role !== 'user' && m.role !== 'assistant') return false;
        if (m.role === 'assistant' && m.order < minUserOrder) return false;
        return true;
      })
      .map((m) => {
        const fileParts = (m.parts || [])
          .filter((p): p is FilePart => p.type === 'file')
          .map((p) => ({
            type: 'file' as const,
            mediaType: p.mediaType,
            filename: p.filename,
            url: p.url,
          }));

        return {
          id: m.id,
          key: m.key,
          content: m.text,
          role: m.role as 'user' | 'assistant',
          timestamp: new Date(m._creationTime),
          fileParts: fileParts.length > 0 ? fileParts : undefined,
          _creationTime: m._creationTime,
          isStreaming: m.status === 'streaming',
        };
      });
  }, [uiMessages]);

  // Find streaming message
  const streamingMessage = uiMessages?.find(
    (m) => m.role === 'assistant' && m.status === 'streaming',
  );

  // Check for active tools in streaming message
  const hasActiveTools = useMemo(() => {
    if (!streamingMessage?.parts) return false;
    return streamingMessage.parts.some((part) => {
      if (!part.type.startsWith('tool-')) return false;
      const toolPart = part as { state?: string };
      return (
        toolPart.state === 'input-streaming' ||
        toolPart.state === 'input-available'
      );
    });
  }, [streamingMessage?.parts]);

  return {
    messages,
    uiMessages,
    loadMore,
    canLoadMore,
    isLoadingMore,
    streamingMessage,
    hasActiveTools,
  };
}
