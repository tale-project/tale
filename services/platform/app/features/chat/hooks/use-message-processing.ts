import { useUIMessages, type UIMessage } from '@convex-dev/agent/react';
import { useMemo } from 'react';

import { api } from '@/convex/_generated/api';

import type { FileAttachment } from '../types';

const HUMAN_INPUT_RESPONSE_PREFIX = 'User responded to question';

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
  role: 'user' | 'assistant' | 'system';
  timestamp: Date;
  attachments?: FileAttachment[];
  fileParts?: FilePart[];
  _creationTime?: number;
  isStreaming?: boolean;
  isHumanInputResponse?: boolean;
}

interface UseMessageProcessingResult {
  messages: ChatMessage[];
  uiMessages: UIMessage[] | undefined;
  loadMore: (numItems: number) => void;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  streamingMessage: UIMessage | undefined;
  pendingToolResponse: UIMessage | undefined;
  hasActiveTools: boolean;
  isProcessingToolResult: boolean;
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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SDK type mismatch: return type narrowed to usable shape
  } = useUIMessages(
    // oxlint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-type-assertion -- SDK type mismatch: streaming query return type incompatible with useUIMessages expectations
    api.threads.queries.getThreadMessagesStreaming as any,
    threadId ? { threadId } : 'skip',
    { initialNumItems: 30, stream: true },
  ) as unknown as {
    results: UIMessage[] | undefined;
    loadMore: (numItems: number) => void;
    status: string;
  };

  const isLoadingMore = paginationStatus === 'LoadingMore';

  // Check if we've loaded the first message (order: 0)
  // The SDK may report canLoadMore=true even when we have all messages
  // because pagination is based on MessageDoc count, not UIMessage count
  const hasFirstMessage = uiMessages?.some((m) => m.order === 0) ?? false;
  const canLoadMore = paginationStatus === 'CanLoadMore' && !hasFirstMessage;

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
        // Keep user and assistant messages
        if (m.role === 'user') return true;
        if (m.role === 'assistant') {
          return m.order >= minUserOrder;
        }
        // Keep system messages that are human input responses
        if (
          m.role === 'system' &&
          m.text?.startsWith(HUMAN_INPUT_RESPONSE_PREFIX)
        ) {
          return true;
        }
        return false;
      })
      .map((m) => {
        // UIMessage.parts is loosely typed — cast required to access file-specific fields
        const fileParts = (
          (m.parts || []) as {
            type: string;
            mediaType?: string;
            filename?: string;
            url?: string;
          }[]
        )
          .filter((p): p is FilePart => p.type === 'file')
          .map((p: FilePart) => ({
            type: 'file' as const,
            mediaType: p.mediaType,
            filename: p.filename,
            url: p.url,
          }));

        const isHumanInputResponse =
          m.role === 'system' &&
          m.text?.startsWith(HUMAN_INPUT_RESPONSE_PREFIX);

        return {
          id: m.id,
          key: m.key,
          content: m.text,
          // UIMessage.role is string — cast required to narrow to expected union
          role: m.role,
          timestamp: new Date(m._creationTime),
          fileParts: fileParts.length > 0 ? fileParts : undefined,
          _creationTime: m._creationTime,
          isStreaming: m.status === 'streaming',
          isHumanInputResponse,
        };
      });
  }, [uiMessages]);

  // Find streaming message
  const streamingMessage = uiMessages?.find(
    (m) => m.role === 'assistant' && m.status === 'streaming',
  );

  // Find pending tool response (waiting for tool results to complete)
  const pendingToolResponse = uiMessages?.find(
    (m) => m.role === 'assistant' && m.status === 'pending',
  );

  // Check for active tools in streaming message
  const hasActiveTools = useMemo(() => {
    if (!streamingMessage?.parts) return false;
    return streamingMessage.parts.some(
      (part: { type: string; state?: string }) => {
        if (!part.type.startsWith('tool-')) return false;
        return (
          part.state === 'input-streaming' || part.state === 'input-available'
        );
      },
    );
  }, [streamingMessage?.parts]);

  // Check if agent is processing tool result (tool completed but no text after it)
  // This handles the gap when sub-agent tools complete but agent hasn't resumed streaming
  const isProcessingToolResult = useMemo(() => {
    if (!uiMessages?.length) return false;

    const lastAssistant = uiMessages.findLast((m) => m.role === 'assistant');
    if (!lastAssistant?.parts?.length) return false;
    if (lastAssistant.status === 'success' || lastAssistant.status === 'failed')
      return false;

    const lastToolIndex = lastAssistant.parts.findLastIndex(
      (part: { type: string }) =>
        part.type.startsWith('tool-') && part.type !== 'tool-result',
    );
    if (lastToolIndex === -1) return false;

    // UIMessage.parts is loosely typed — cast required to access tool-specific fields
    const lastToolPart = lastAssistant.parts[lastToolIndex] as {
      type: string;
      state?: string;
    };
    if (lastToolPart?.state !== 'output-available') return false;

    const partsAfterTool = lastAssistant.parts.slice(lastToolIndex + 1);
    const hasTextAfterTool = partsAfterTool.some(
      (part: { type: string; text?: string }) =>
        part.type === 'text' && part.text,
    );

    return !hasTextAfterTool;
  }, [uiMessages]);

  return {
    messages,
    uiMessages,
    loadMore,
    canLoadMore,
    isLoadingMore,
    streamingMessage,
    pendingToolResponse,
    hasActiveTools,
    isProcessingToolResult,
  };
}
