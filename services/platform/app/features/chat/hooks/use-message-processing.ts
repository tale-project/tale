import { useUIMessages, type UIMessage } from '@convex-dev/agent/react';
import { useEffect, useMemo, useRef } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type {
  SystemMessageDisplay,
  SystemMsgTag,
} from '@/lib/shared/constants/system-message-tags';
import {
  getSystemMessageDisplay,
  parseSystemMessageTag,
} from '@/lib/shared/constants/system-message-tags';

import { useChatLayout } from '../context/chat-layout-context';
import type { FileAttachment } from '../types';
import {
  sameAttachments,
  sameFileParts,
  sameParts,
} from '../utils/message-equality';
import { hasInFlightTool } from '../utils/thought-predicates';
import { isAgentActivelyWorking, useSessionProgress } from './queries';

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

// Folder pin marker (kb_reference_block.ts::buildKbFolderBlock) — key names
// differ from the file marker on purpose so neither regex can match the
// other's block. `folderSkippedCount` is OPTIONAL in the regex: a message
// sent before issue #2598 shipped was persisted without it, and the group
// must still match (defaulting to 0 below) so an old sent bubble doesn't
// regress to showing the raw, unstripped marker text.
const KB_FOLDER_MARKER =
  /\*\(kbFolderId: ([a-z0-9]+) \| folderName: (.+?) \| folderFileCount: (\d+)(?: \| folderSkippedCount: (\d+))?\)\*/g;
const INTERNAL_KB_FOLDER_BLOCK =
  /\n?\n?[^\n]+\n\*\(kbFolderId: [a-z0-9]+ \| folderName: .+? \| folderFileCount: \d+(?: \| folderSkippedCount: \d+)?\)\*/g;

/** A pinned folder parsed back off the message body for the sent bubble. */
export interface KbFolderRef {
  folderId: string;
  name: string;
  fileCount: number;
  /** Files considered but not RAG-indexed (0 for pre-#2598 messages, which
   *  never recorded this). */
  skippedCount: number;
}

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

export function extractKbFolderRefs(text: string): KbFolderRef[] {
  const refs: KbFolderRef[] = [];
  for (const match of text.matchAll(KB_FOLDER_MARKER)) {
    refs.push({
      folderId: match[1],
      name: match[2],
      fileCount: Number(match[3]),
      skippedCount: match[4] !== undefined ? Number(match[4]) : 0,
    });
  }
  return refs;
}

export function stripInternalFileReferences(text: string) {
  return text
    .replace(INTERNAL_ATTACHMENT_MARKER, '')
    .replace(INTERNAL_ENRICHED_BLOCK, '')
    .replace(INTERNAL_KB_FOLDER_BLOCK, '')
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
  /** `@`-pinned folders, parsed from the folder marker block. */
  folderRefs?: KbFolderRef[];
  fileParts?: FilePart[];
  _creationTime?: number;
  order?: number;
  /** Position of this row WITHIN its prompt group (the SDK's `stepOrder`): a
   *  user prompt is `(order, 0)`, its assistant reply steps `(order, 1..k)`.
   *  `(order, stepOrder)` is the server's canonical, clock-free ordering — used
   *  by useMergedChatItems so a streaming reply can't transiently sort above its
   *  user row under clock skew. Undefined on optimistic/pending rows. */
  stepOrder?: number;
  isStreaming?: boolean;
  /** One-cycle isStreaming carry-over for a message that landed terminal WITH
   *  text after being observed streaming-and-empty: kept streaming so
   *  TypewriterText mounts animated, but the turn is already finished —
   *  "still working" affordances (trailing dots) must not show. */
  isFinalReveal?: boolean;
  isAborted?: boolean;
  isFailed?: boolean;
  error?: string;
  systemMessageDisplay?: SystemMessageDisplay;
  systemMessageBody?: string;
  systemMessageTag?: SystemMsgTag;
  /** Raw UIMessage parts (reasoning + tool calls) for the thought-process
   *  timeline. Present on assistant messages; undefined elsewhere. */
  parts?: UIMessage['parts'];
  /** Better Auth userId OR agent slug of the message author (from the agent-SDK
   *  UIMessage `userId`). Undefined for legacy messages saved before author
   *  attribution. Consumed by multi-party views (Discussions) to resolve the
   *  per-message author; unused by 1:1 chat. */
  authorId?: string;
  /** Client-only optimistic assistant shell shown from send until the real
   *  assistant row is visible in the processed message list. */
  isOptimisticShell?: boolean;
}

interface UseMessageProcessingOptions {
  /** Multi-party surfaces (Discussions): keep assistant-role messages that
   *  precede the first loaded user message. 1:1 chat drops those as orphans
   *  (a chat thread always starts with a user prompt), but a discussion
   *  legitimately OPENS with an agent/system-authored message stored as
   *  role 'assistant' — the orphan filter would hide it forever as soon as
   *  any member replied (#2638). */
  keepPreUserAssistantMessages?: boolean;
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
 * Render-field equality for two ChatMessages sharing a `key`. Covers every
 * field MessageBubble's memo comparator reads PLUS the fields the list scans
 * read (role/order/_creationTime/system*), so the identity hold below can
 * safely reuse the prior object reference when nothing renderable changed.
 * MUST include `isStreaming`/`isFinalReveal` so the stream→done transition
 * always yields a FRESH reference (the one-cycle isFinalReveal carry-over and
 * the footer gates depend on observing it). `timestamp` is derived purely from
 * `_creationTime`, so comparing the latter covers it.
 */
function chatMessageRenderEqual(a: ChatMessage, b: ChatMessage): boolean {
  return (
    a.id === b.id &&
    a.role === b.role &&
    a.authorId === b.authorId &&
    a.content === b.content &&
    a._creationTime === b._creationTime &&
    a.order === b.order &&
    a.stepOrder === b.stepOrder &&
    a.isStreaming === b.isStreaming &&
    a.isFinalReveal === b.isFinalReveal &&
    a.isAborted === b.isAborted &&
    a.isFailed === b.isFailed &&
    a.error === b.error &&
    a.systemMessageDisplay === b.systemMessageDisplay &&
    a.systemMessageBody === b.systemMessageBody &&
    a.systemMessageTag === b.systemMessageTag &&
    a.isOptimisticShell === b.isOptimisticShell &&
    sameParts(a.parts, b.parts) &&
    sameAttachments(a.attachments, b.attachments) &&
    sameFileParts(a.fileParts, b.fileParts)
  );
}

/**
 * Hook to fetch and process thread messages.
 * Handles UIMessage → ChatMessage conversion, pagination, and streaming state.
 */
export function useMessageProcessing(
  threadId: string | undefined,
  options?: UseMessageProcessingOptions,
): UseMessageProcessingResult {
  const keepPreUserAssistantMessages =
    options?.keepPreUserAssistantMessages === true;
  const organizationId = useOrganizationId();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex agent SDK useUIMessages expects UIMessagesQuery which doesn't match generated API types
  const query = api.threads.queries
    .getThreadMessagesStreaming as unknown as Parameters<
    typeof useUIMessages
  >[0];
  const {
    results: uiMessages,
    loadMore,
    status: paginationStatus,
  } = useUIMessages(
    query,
    threadId && organizationId ? { threadId, organizationId } : 'skip',
    {
      initialNumItems: 30,
      // @ts-expect-error -- Convex agent SDK StreamQuery conditional type doesn't resolve correctly with generated API types; stream: true is valid at runtime
      stream: true,
    },
  );

  // Consolidated thread metadata behind a SINGLE access check + subscription.
  // ChatInterface reads the same getThreadMeta with identical args, so the two
  // share ONE Convex subscription per thread switch instead of four separate
  // ones (failed errors, generation status, fork info, project).
  // Non-throwing: the self-hosted backend can transiently blow Convex's 1s
  // query limit on the org-membership-gated getThreadMeta (the isOrgMember
  // cross-component hop, amplified under load). useQuery would re-throw that
  // into the page error boundary and blank the whole chat — fatal for arena,
  // whose split view lives in ephemeral state a remount can't restore. Degrade
  // to a loading state instead; the reactive query recovers on the next tick.
  const { data: threadMeta } = useConvexQuery(
    api.threads.queries.getThreadMeta,
    threadId && organizationId ? { threadId, organizationId } : 'skip',
  );

  // Error strings of failed messages (was getFailedMessageErrors). Kept out of
  // the streaming query to avoid .map()-ing UIMessages (which creates new
  // object references and breaks React/SDK dedup).
  const messageErrors = threadMeta?.failedErrors;

  // Thread-level generation status. Held true across an entire multi-step
  // turn (set by markGenerating, cleared by clearGenerationStatus) including
  // the gap between pre-tool message success and post-tool message creation
  // — exactly when an orphan file-only message must stay hidden. Prefer this
  // over scanning uiMessages for a streaming/pending status, which is
  // undefined during that gap.
  const isGenerating = threadMeta?.isGenerating;

  // After an external-agent (Claude Code / OpenCode) turn emits its result, the
  // process LINGERS on held-open stdin for instant next-message delivery, so
  // `isGenerating`/generationStatus stay true even though the turn is over.
  // Subtract that lingering window: the canonical "the agent is actively
  // producing this message right now" is generating AND not lingering-idle.
  // Without this, the last assistant bubble below latches its streaming
  // affordances (the "Thinking" header + trailing dots) for the whole linger.
  // Same `agentIdleAt` signal the composer + Sandbox pill read, so all surfaces
  // agree. `useSessionProgress` is null for normal-chat threads (no sandbox
  // op), so `effectiveGenerating` collapses to plain `isGenerating` there.
  const sessionProgress = useSessionProgress(threadId);
  const effectiveGenerating = isAgentActivelyWorking(
    isGenerating,
    sessionProgress,
  );

  // Client-side pending-send signal. When the user has just clicked send
  // but the new user message hasn't been persisted yet, `pendingMessage` is
  // non-null on the same thread. During that narrow window, isGenerating is
  // already true (markGenerating committed first for TTFT) but uiMessages
  // still reflects the PREVIOUS completed turn — so the intra-turn file-only
  // hide logic below would mistakenly treat the previous turn's file-only
  // reply as the currently-generating turn's pre-tool message and hide it.
  // The presence of a matching pendingMessage is the unambiguous signal
  // that we're in the cross-turn gap (not an intra-turn gap).
  const { pendingMessage } = useChatLayout();
  const hasPendingSendForThread =
    !!pendingMessage &&
    (pendingMessage.threadId === threadId ||
      pendingMessage.arenaThreadIdB === threadId);

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

  // Per-message identity hold: across a streamed token only the tail bubble's
  // ChatMessage actually changes, but the `.map()` below rebuilds every object.
  // Reuse the prior reference for any message whose render fields are unchanged
  // so MessageBubble's memo bails on the first `===` for all history and the
  // downstream array hold (use-merged-chat-items) can keep the list identity.
  // Keyed by message key; mutated inside the messages useMemo, exactly like the
  // streaming refs above.
  const messageIdentityRef = useRef(new Map<string, ChatMessage>());

  // Convert UIMessage to ChatMessage format
  // Handles orphan filtering (Issue #184) and file part extraction
  const messages: ChatMessage[] = useMemo(() => {
    // Reuse prior ChatMessage object references for messages whose render
    // fields are unchanged, so only the genuinely-changed (streaming) bubble
    // gets a new identity per token. Applied to every return path below.
    const reconcile = (arr: ChatMessage[]): ChatMessage[] => {
      const prev = messageIdentityRef.current;
      const next = new Map<string, ChatMessage>();
      const held = arr.map((m) => {
        const prior = prev.get(m.key);
        const kept = prior && chatMessageRenderEqual(prior, m) ? prior : m;
        next.set(m.key, kept);
        return kept;
      });
      messageIdentityRef.current = next;
      return held;
    };

    if (!uiMessages?.length) {
      messageIdentityRef.current = new Map();
      return [];
    }

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
    // gap.
    //
    // Scope to the current turn's order. Three cases, distinguished by the
    // relationship between maxAssistantOrder and maxUserOrder, plus the
    // client's `pendingMessage` signal:
    //   - maxAssistant < maxUser: new user message arrived but no assistant
    //     response yet — nothing to hide.
    //   - maxAssistant === maxUser: ambiguous. Could be intra-turn gap (user
    //     + appendFilePart share one order) OR cross-turn gap (previous turn
    //     fully settled; client just clicked send; new user message not yet
    //     saved server-side). Disambiguate with `hasPendingSendForThread`:
    //     if set, it's the cross-turn case — DON'T hide the previous turn's
    //     file-only reply. Otherwise it's intra-turn — DO hide.
    //   - maxAssistant > maxUser: intra-turn with strict advance — hide.
    let activeTurnOrder: number | undefined;
    if (effectiveGenerating) {
      let maxUserOrder = -Infinity;
      let maxAssistantOrder = -Infinity;
      for (const m of uiMessages) {
        if (m.role === 'user' && m.order > maxUserOrder) {
          maxUserOrder = m.order;
        } else if (m.role === 'assistant' && m.order > maxAssistantOrder) {
          maxAssistantOrder = m.order;
        }
      }
      const isIntraTurnGap =
        Number.isFinite(maxAssistantOrder) &&
        (maxAssistantOrder > maxUserOrder ||
          (maxAssistantOrder === maxUserOrder && !hasPendingSendForThread));
      if (isIntraTurnGap) {
        activeTurnOrder = maxAssistantOrder;
      }
    }

    // The thread's LAST assistant message — the only one a live turn can be
    // writing into. External-agent turns persist incrementally with status
    // 'pending' for the whole run (never 'streaming'), so the pending branch
    // below treats this message as streaming while the thread generates;
    // scoping to the last assistant keeps an ORPHANED pending message in
    // history from going live again when a later turn runs.
    let lastAssistantKey: string | undefined;
    for (let i = uiMessages.length - 1; i >= 0; i--) {
      const candidate = uiMessages[i];
      if (candidate && candidate.role === 'assistant') {
        lastAssistantKey = candidate.key;
        break;
      }
    }

    const currentKeys = new Set<string>();

    const result = uiMessages
      .filter((m) => {
        // Keep user and assistant messages
        if (m.role === 'user') return true;
        if (m.role === 'assistant') {
          // Discussions keep every assistant message — an agent/system opener
          // sits BEFORE the first user reply and is not an orphan (#2638).
          return keepPreUserAssistantMessages || m.order >= minUserOrder;
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
        let systemMessageTag: SystemMsgTag | undefined;
        if (m.role === 'system' && m.text) {
          const parsed = parseSystemMessageTag(m.text);
          systemMessageDisplay = getSystemMessageDisplay(parsed.tag);
          systemMessageBody = parsed.body;
          systemMessageTag = parsed.tag ?? undefined;
        }

        currentKeys.add(m.key);

        // A tool-only turn can be observed FIRST as status:'pending' (never
        // 'streaming') with a tool part already mid-flight — e.g. an immediate
        // tool call before any reasoning/text streams. The in-bubble thought
        // header + inline tool row already MOUNT unconditionally (showTimeline
        // gates on hasThoughtSteps, not streaming); the only thing missing for
        // such a turn is the ACTIVE state, so we set isStreaming=true to render
        // the tool row with a live spinner during the tool call.
        const messageHasInFlightTool =
          m.role === 'assistant' && hasInFlightTool(m.parts);

        let isStreaming = false;
        let isFinalReveal = false;
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
          // `isFinalReveal` tags the carried cycle so "still working"
          // affordances (the bubble's trailing dots) know the turn is in fact
          // already finished.
          if (emptyStreamingKeysRef.current.has(m.key) && m.text) {
            isStreaming = true;
            isFinalReveal = true;
          }
          emptyStreamingKeysRef.current.delete(m.key);
          streamingKeysRef.current.delete(m.key);
        } else {
          // This branch is reached only for status==='pending'. AND the
          // message-level signals with the thread-level generation signal so
          // an ORPHANED pending message — never reconciled to success/failed
          // after a hard process kill — won't latch a spinner forever once
          // generation has stopped (or gone stale). Two live shapes:
          //   - The LAST assistant message while the thread generates: an
          //     external-agent (Claude Code / OpenCode) turn persists its
          //     timeline incrementally with status 'pending' for the WHOLE
          //     run, so it must read as streaming even between tool calls
          //     (previously it flickered "done" the moment a tool result
          //     landed, surfacing the toolbar + duplicate footer timeline
          //     mid-turn).
          //   - A non-last pending message with a tool mid-flight: the
          //     pre-existing tool-only-turn case (observed before any
          //     reasoning/text streams).
          isStreaming =
            streamingKeysRef.current.has(m.key) ||
            (m.role === 'assistant' &&
              effectiveGenerating &&
              (m.key === lastAssistantKey || messageHasInFlightTool));
        }

        const attachments =
          m.role === 'user' && m.text
            ? extractFileAttachments(m.text)
            : undefined;
        const folderRefs =
          m.role === 'user' && m.text ? extractKbFolderRefs(m.text) : undefined;

        return {
          id: m.id,
          key: m.key,
          content: m.text ? stripInternalFileReferences(m.text) : '',
          role: m.role,
          authorId: m.userId,
          timestamp: new Date(m._creationTime),
          attachments:
            attachments && attachments.length > 0 ? attachments : undefined,
          folderRefs:
            folderRefs && folderRefs.length > 0 ? folderRefs : undefined,
          fileParts: fileParts.length > 0 ? fileParts : undefined,
          _creationTime: m._creationTime,
          order: m.order,
          stepOrder: m.stepOrder,
          isStreaming,
          isFinalReveal,
          isAborted:
            m.role === 'assistant' && m.status === 'failed' && !m.text?.trim(),
          isFailed:
            m.role === 'assistant' && m.status === 'failed' && !!m.text?.trim(),
          // Carry reasoning/tool parts on assistant messages for the
          // thought-process timeline. User messages don't have a timeline.
          parts:
            m.role === 'assistant' && Array.isArray(m.parts)
              ? m.parts
              : undefined,
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
          systemMessageTag,
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

    // Fast path (the common case, hit on every streamed token): there are no
    // file-only tool messages to hide or merge this turn, so the filter+map
    // rebuild below would just clone the array unchanged. Skip it.
    if (fileOnlyKeys.size === 0 && activeTurnOrder == null) {
      return reconcile(result);
    }

    // Pass 2: rebuild without file-only messages, merging extra parts immutably.
    // Also hide any file-only message that did not find a merge target but
    // shares its order with an in-flight streaming/pending assistant message
    // — the forward merge will pick it up as soon as that message streams
    // text, so deferring is preferable to a transient standalone bubble.
    return reconcile(
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
        }),
    );
  }, [
    uiMessages,
    messageErrors,
    effectiveGenerating,
    hasPendingSendForThread,
    keepPreUserAssistantMessages,
  ]);

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
