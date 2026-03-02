import { useUIMessages, type UIMessage } from '@convex-dev/agent/react';
import { useEffect, useMemo, useRef } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { api } from '@/convex/_generated/api';

import type { FileAttachment } from '../types';

const HUMAN_INPUT_RESPONSE_PREFIX = 'User responded to question';

const INTERNAL_ATTACHMENT_MARKER =
  /\n?\n?\[ATTACHED FILES - Pre-analysis was not available\. Use your tools to process these files\.\]/;
const INTERNAL_FILE_REF = /\n?📎 \*\*[^*]+\*\* \([^)]*fileId: [a-z0-9]+\)/g;
const INTERNAL_FILEID_ITALIC =
  /\n?\*\(fileId: [a-z0-9]+(?: \| fileName: .+? \| fileType: .+? \| fileSize: \d+)?\)\*/g;

// Matches a full enriched attachment block: markdown line + enriched fileId marker.
// Only strips the markdown line when paired with an enriched marker (old messages keep their links).
const INTERNAL_ENRICHED_BLOCK =
  /\n?\n?(?:📎 \[[^\]]+\]\([^)]+\) \([^)]+\)|📄 \[[^\]]+\]\([^)]+\) \([^)]+\)|!\[[^\]]+\]\([^)]+\))\n\*\(fileId: [a-z0-9]+ \| fileName: .+? \| fileType: .+? \| fileSize: \d+\)\*/g;

const ENRICHED_ATTACHMENT_MARKER =
  /\*\(fileId: ([a-z0-9]+) \| fileName: (.+?) \| fileType: (.+?) \| fileSize: (\d+)\)\*/g;

export function extractFileAttachments(text: string): FileAttachment[] {
  const attachments: FileAttachment[] = [];
  for (const match of text.matchAll(ENRICHED_ATTACHMENT_MARKER)) {
    attachments.push({
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fileId from marker is a Convex storage ID string
      fileId: match[1] as Id<'_storage'>,
      fileName: match[2],
      fileType: match[3],
      fileSize: Number(match[4]),
    });
  }
  return attachments;
}

export function stripInternalFileReferences(text: string) {
  return text
    .replace(INTERNAL_ATTACHMENT_MARKER, '')
    .replace(INTERNAL_ENRICHED_BLOCK, '')
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
  isAborted?: boolean;
  isHumanInputResponse?: boolean;
}

interface UseMessageProcessingResult {
  messages: ChatMessage[];
  uiMessages: UIMessage[] | undefined;
  loadMore: (numItems: number) => void;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  activeMessage: UIMessage | undefined;
  streamingMessage: UIMessage | undefined;
  pendingToolResponse: UIMessage | undefined;
  hasActiveTools: boolean;
  terminalAssistantCount: number;
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

  // Adaptive auto-load: pagination is based on MessageDoc count, not UIMessage count.
  // A single tool-heavy turn can consume most of the initial page (N tool calls =
  // N*2+2 MessageDocs). When too few user messages are visible, load more automatically
  // so the user always sees enough conversation context.
  //
  // Uses paginationStatus directly instead of canLoadMore because canLoadMore
  // includes a hasFirstMessage guard (any message with order=0), which becomes
  // true as soon as assistant tool messages (order=0) load — even when the user
  // message (also order=0) hasn't been fetched yet.
  //
  // Safety: capped at MAX_AUTO_LOADS to prevent excessive requests in extreme
  // tool-heavy threads. After the cap, the user can still manually "Load More".
  const MAX_AUTO_LOADS = 5;
  const autoLoadCountRef = useRef(0);

  const visibleUserMessageCount = useMemo(
    () => uiMessages?.filter((m) => m.role === 'user').length ?? 0,
    [uiMessages],
  );

  useEffect(() => {
    if (
      paginationStatus === 'CanLoadMore' &&
      !isLoadingMore &&
      visibleUserMessageCount < 3 &&
      autoLoadCountRef.current < MAX_AUTO_LOADS
    ) {
      autoLoadCountRef.current++;
      loadMore(30);
    }
  }, [paginationStatus, isLoadingMore, visibleUserMessageCount, loadMore]);

  // Track which messages have been seen as streaming. Once streaming,
  // stay streaming until a terminal status (success/failed) is observed.
  // This prevents transient reconnection states (status briefly "pending")
  // from resetting the typewriter animation.
  const streamingKeysRef = useRef(new Set<string>());

  // Track messages that were streaming while their text was still empty
  // (e.g. during tool turns / RAG retrieval). When such a message reaches
  // a terminal status with text in the same reactive update, we keep
  // isStreaming=true for one cycle so TypewriterText can mount and animate
  // instead of showing the full response instantly.
  const emptyStreamingKeysRef = useRef(new Set<string>());

  // Convert UIMessage to ChatMessage format
  // Handles orphan filtering (Issue #184) and file part extraction
  const messages: ChatMessage[] = useMemo(() => {
    if (!uiMessages?.length) return [];

    const userMessages = uiMessages.filter((m) => m.role === 'user');
    const minUserOrder =
      userMessages.length > 0
        ? Math.min(...userMessages.map((m) => m.order))
        : 0;

    const currentKeys = new Set<string>();

    const result = uiMessages
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

        currentKeys.add(m.key);

        let isStreaming = false;
        if (m.status === 'streaming') {
          streamingKeysRef.current.add(m.key);
          isStreaming = true;
          if (!m.text) {
            emptyStreamingKeysRef.current.add(m.key);
          } else {
            emptyStreamingKeysRef.current.delete(m.key);
          }
        } else if (m.status === 'success' || m.status === 'failed') {
          // If this message was streaming with no text and now has content,
          // keep isStreaming=true for one cycle so TypewriterText can mount
          // with animation instead of showing the full response instantly.
          if (emptyStreamingKeysRef.current.has(m.key) && m.text) {
            isStreaming = true;
          }
          emptyStreamingKeysRef.current.delete(m.key);
          streamingKeysRef.current.delete(m.key);
        } else {
          isStreaming = streamingKeysRef.current.has(m.key);
        }

        const attachments =
          m.role === 'user' && m.text
            ? extractFileAttachments(m.text)
            : undefined;

        return {
          id: m.id,
          key: m.key,
          content: m.text ? stripInternalFileReferences(m.text) : '',
          role: m.role,
          timestamp: new Date(m._creationTime),
          attachments:
            attachments && attachments.length > 0 ? attachments : undefined,
          fileParts: fileParts.length > 0 ? fileParts : undefined,
          _creationTime: m._creationTime,
          isStreaming,
          isAborted:
            m.role === 'assistant' && m.status === 'failed' && !m.text?.trim(),
          isHumanInputResponse,
        };
      });

    // Clean up stale entries for messages no longer in the list
    for (const key of streamingKeysRef.current) {
      if (!currentKeys.has(key)) {
        streamingKeysRef.current.delete(key);
      }
    }
    for (const key of emptyStreamingKeysRef.current) {
      if (!currentKeys.has(key)) {
        emptyStreamingKeysRef.current.delete(key);
      }
    }

    return result;
  }, [uiMessages]);

  // Find active assistant message (streaming or pending tool execution).
  // Unified lookup ensures ThinkingAnimation receives tool parts during both phases.
  const activeMessage = uiMessages?.find(
    (m) =>
      m.role === 'assistant' &&
      (m.status === 'streaming' || m.status === 'pending'),
  );

  const streamingMessage =
    activeMessage?.status === 'streaming' ? activeMessage : undefined;

  const pendingToolResponse =
    activeMessage?.status === 'pending' ? activeMessage : undefined;

  // Count terminal assistant messages for slow-network isPending clearing.
  // This is a monotonically-increasing signal immune to React 18 batching
  // coalescing (unlike the boolean isGenerating toggle).
  const terminalAssistantCount = useMemo(
    () =>
      uiMessages?.filter(
        (m) =>
          m.role === 'assistant' &&
          (m.status === 'success' || m.status === 'failed'),
      ).length ?? 0,
    [uiMessages],
  );

  // Check for active tools in active message (streaming or pending)
  const hasActiveTools = useMemo(() => {
    if (!activeMessage?.parts) return false;
    return activeMessage.parts.some(
      (part: { type: string; state?: string }) => {
        if (!part.type.startsWith('tool-')) return false;
        return (
          part.state === 'input-streaming' || part.state === 'input-available'
        );
      },
    );
  }, [activeMessage?.parts]);

  return {
    messages,
    uiMessages,
    loadMore,
    canLoadMore,
    isLoadingMore,
    activeMessage,
    streamingMessage,
    pendingToolResponse,
    hasActiveTools,
    terminalAssistantCount,
  };
}
