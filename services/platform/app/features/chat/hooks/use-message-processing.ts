import { useUIMessages, type UIMessage } from '@convex-dev/agent/react';
import { useQuery } from 'convex/react';
import { useEffect, useMemo, useRef } from 'react';

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { SystemMessageDisplay } from '@/lib/shared/constants/system-message-tags';
import {
  getSystemMessageDisplay,
  parseSystemMessageTag,
} from '@/lib/shared/constants/system-message-tags';

import type { FileAttachment } from '../types';

const INTERNAL_ATTACHMENT_MARKER =
  /\n?\n?\[ATTACHED FILES - Pre-analysis was not available\. Use your tools to process these files\.\]/;
const INTERNAL_FILE_REF = /\n?📎 \*\*[^*]+\*\* \([^)]*fileId: [a-z0-9]+\)/g;
const INTERNAL_FILEID_ITALIC =
  /\n?\*\(fileId: [a-z0-9]+(?: \| fileName: .+? \| fileType: .+? \| fileSize: \d+)?\)\*/g;

// Matches a full enriched attachment block: markdown line + enriched fileId marker.
// Only strips the markdown line when paired with an enriched marker (old messages keep their links).
const INTERNAL_ENRICHED_BLOCK =
  /\n?\n?[^\n]+\n\*\(fileId: [a-z0-9]+ \| fileName: .+? \| fileType: .+? \| fileSize: \d+\)\*/g;

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
  order?: number;
  isStreaming?: boolean;
  isAborted?: boolean;
  isFailed?: boolean;
  error?: string;
  systemMessageDisplay?: SystemMessageDisplay;
  systemMessageBody?: string;
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

  // Separate lightweight query for error strings of failed messages.
  // Kept out of the streaming query to avoid .map()-ing UIMessages (which
  // creates new object references and breaks React/SDK dedup).
  const messageErrors = useQuery(
    api.threads.queries.getFailedMessageErrors,
    threadId ? { threadId } : 'skip',
  );

  // Thread-level generation status. Held true across an entire multi-step
  // turn (set by markGenerating, cleared by clearGenerationStatus) including
  // the gap between pre-tool message success and post-tool message creation
  // — exactly when an orphan file-only message must stay hidden. Prefer this
  // over scanning uiMessages for a streaming/pending status, which is
  // undefined during that gap.
  const isGenerating = useQuery(
    api.threads.queries.isThreadGenerating,
    threadId ? { threadId } : 'skip',
  );

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

  // Reset auto-load counter on thread switch so new threads can auto-load
  // even if the previous thread exhausted the cap.
  useEffect(() => {
    autoLoadCountRef.current = 0;
  }, [threadId]);

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

    // When a tool writes a file-only assistant message (via appendFilePart)
    // mid-stream, its row lands before the post-tool text message does.
    // If we render it standalone in that window, the bubble unmounts and the
    // post-tool message's TypewriterText mounts fresh once the merge catches
    // up — visible as a flicker. Hide file-only messages while the turn is
    // still generating; the forward merge attaches them once the post-tool
    // message gains content. Use threadMetadata.generationStatus (via
    // isThreadGenerating) rather than a streaming/pending status scan —
    // those statuses are undefined during the gap between pre-tool `success`
    // and post-tool creation, but generationStatus stays true across that
    // gap. Scope to the current turn by taking the max assistant order in
    // the same uiMessages snapshot the merge iterates, so a completed
    // earlier turn's file-only (if any) is not hidden by a later turn's
    // generation.
    let activeTurnOrder: number | undefined;
    if (isGenerating) {
      let maxOrder = -Infinity;
      for (const m of uiMessages) {
        if (m.role === 'assistant' && m.order > maxOrder) maxOrder = m.order;
      }
      if (Number.isFinite(maxOrder)) activeTurnOrder = maxOrder;
    }

    const currentKeys = new Set<string>();

    const result = uiMessages
      .filter((m) => {
        // Keep user and assistant messages
        if (m.role === 'user') return true;
        if (m.role === 'assistant') {
          return m.order >= minUserOrder;
        }
        if (m.role === 'system') {
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

        let systemMessageDisplay: SystemMessageDisplay | undefined;
        let systemMessageBody: string | undefined;
        if (m.role === 'system' && m.text) {
          const parsed = parseSystemMessageTag(m.text);
          systemMessageDisplay = getSystemMessageDisplay(parsed.tag);
          systemMessageBody = parsed.body;
        }

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
          order: m.order,
          isStreaming,
          isAborted:
            m.role === 'assistant' && m.status === 'failed' && !m.text?.trim(),
          isFailed:
            m.role === 'assistant' && m.status === 'failed' && !!m.text?.trim(),
          error:
            messageErrors?.[m.id] ??
            // UIMessage.id is the first message in a group, but the error
            // lives on the last (failed) message which has a different _id.
            // Fall back to any error in the map for this failed message.
            (m.status === 'failed' && messageErrors
              ? Object.values(messageErrors)[0]
              : undefined),
          systemMessageDisplay,
          systemMessageBody,
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

    // Merge file-only assistant messages into the nearest following text-bearing
    // assistant message in the SAME turn (matching `order`). The file part
    // message has an earlier _creationTime (saved during the tool call) so it
    // sorts before the text message.
    //
    // The `order` guard is critical: without it, a file-only assistant message
    // whose companion text never arrives (e.g. an image-generation agent that
    // outputs only fileParts) would steal-attach to whatever subsequent turn's
    // assistant text happens to exist — most visibly, an error message from
    // the NEXT user turn, making the successful image appear fused with an
    // unrelated later error. `order` corresponds to a logical turn, so
    // constraining the merge to a single turn prevents cross-turn bleeding
    // while still preserving tool-call behavior (file + text share an order).
    //
    // Pass 1: build a map of key → extra fileParts to attach, O(n)
    const extraFileParts = new Map<string, FilePart[]>();
    const fileOnlyKeys = new Set<string>();
    for (let i = 0; i < result.length; i++) {
      const msg = result[i];
      if (!msg) continue;
      if (
        msg.role !== 'assistant' ||
        msg.content ||
        msg.isAborted ||
        !msg.fileParts?.length
      )
        continue;

      // Find the next text-bearing assistant message in the SAME turn.
      for (let j = i + 1; j < result.length; j++) {
        const next = result[j];
        if (!next) continue;
        // Bail out once we cross into a later turn — file-only message stays
        // standalone in its own turn.
        if (
          msg.order != null &&
          next.order != null &&
          next.order !== msg.order
        ) {
          break;
        }
        if (next.role === 'assistant' && next.content) {
          extraFileParts.set(next.key, [
            ...(extraFileParts.get(next.key) ?? []),
            ...(msg.fileParts ?? []),
          ]);
          fileOnlyKeys.add(msg.key);
          break;
        }
      }
    }

    // Pass 2: rebuild without file-only messages, merging extra parts immutably.
    // Also hide any file-only message that did not find a merge target but
    // shares its order with an in-flight streaming/pending assistant message
    // — the forward merge will pick it up as soon as that message streams
    // text, so deferring is preferable to a transient standalone bubble.
    return (
      result
        .filter((msg) => {
          if (fileOnlyKeys.has(msg.key)) return false;
          if (
            activeTurnOrder != null &&
            msg.role === 'assistant' &&
            !msg.content &&
            !msg.isAborted &&
            msg.fileParts?.length &&
            msg.order === activeTurnOrder
          ) {
            return false;
          }
          return true;
        })
        // oxlint-disable-next-line oxc/no-map-spread -- immutable update required
        .map((msg) => {
          const extra = extraFileParts.get(msg.key);
          if (!extra) return msg;
          return { ...msg, fileParts: [...(msg.fileParts ?? []), ...extra] };
        })
    );
  }, [uiMessages, messageErrors, isGenerating]);

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
  };
}
