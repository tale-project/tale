import { useUIMessages, type UIMessage } from '@convex-dev/agent/react';
import { useMemo } from 'react';

import { api } from '@/convex/_generated/api';

import type { FileAttachment } from '../types';

const HUMAN_INPUT_RESPONSE_PREFIX = 'User responded to question';

const INTERNAL_ATTACHMENT_MARKER =
  /\n?\n?\[ATTACHED FILES - Pre-analysis was not available\. Use your tools to process these files\.\]/;
const INTERNAL_FILE_REF = /\n?📎 \*\*[^*]+\*\* \([^)]*fileId: [a-z0-9]+\)/g;
const INTERNAL_FILEID_ITALIC = /\n?\*\(fileId: [a-z0-9]+\)\*/g;

export function stripInternalFileReferences(text: string) {
  return text
    .replace(INTERNAL_ATTACHMENT_MARKER, '')
    .replace(INTERNAL_FILE_REF, '')
    .replace(INTERNAL_FILEID_ITALIC, '')
    .trim();
}

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
  hasIncompleteAssistantMessage: boolean;
}

/**
 * Hook to fetch and process thread messages.
 * Handles UIMessage → ChatMessage conversion, pagination, and streaming state.
 */
export function useMessageProcessing(
  threadId: string | undefined,
): UseMessageProcessingResult {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex agent SDK useUIMessages expects UIMessagesQuery which doesn't match generated API types
  const query = api.threads.queries
    .getThreadMessagesStreaming as unknown as Parameters<
    typeof useUIMessages
  >[0];
  const {
    results: uiMessages,
    loadMore,
    status: paginationStatus,
  } = useUIMessages(query, threadId ? { threadId } : 'skip', {
    initialNumItems: 30,
    // @ts-expect-error -- Convex agent SDK StreamQuery conditional type doesn't resolve correctly with generated API types; stream: true is valid at runtime
    stream: true,
  });

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
        const parts: unknown[] = Array.isArray(m.parts) ? m.parts : [];
        const fileParts = parts
          .filter(
            (p): p is FilePart =>
              typeof p === 'object' &&
              p !== null &&
              'type' in p &&
              p.type === 'file',
          )
          .map((p) => ({
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
          content: m.text ? stripInternalFileReferences(m.text) : '',
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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex agent SDK returns loosely typed UIMessage.parts
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

  // Check if the last assistant message is still in a non-terminal state.
  // Covers gaps where status transitions between 'streaming' and 'pending'
  // would otherwise cause loading to flicker off.
  const hasIncompleteAssistantMessage = useMemo(() => {
    if (!uiMessages?.length) return false;
    const lastAssistant = uiMessages.findLast((m) => m.role === 'assistant');
    if (!lastAssistant) return false;
    return (
      lastAssistant.status !== 'success' && lastAssistant.status !== 'failed'
    );
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
    hasIncompleteAssistantMessage,
  };
}
