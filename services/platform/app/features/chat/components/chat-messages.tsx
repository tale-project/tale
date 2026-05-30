'use client';

import { Button } from '@tale/ui/button';
import { useQuery } from 'convex/react';
import { AlertTriangle, Loader2, CheckCircle2, Lock } from 'lucide-react';
import {
  useId,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  useEffect,
  type RefObject,
} from 'react';

import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useBranchContext } from '../context/branch-context';
import type { ChatItem } from '../hooks/use-merged-chat-items';
import { usePersonalizationActiveForThread } from '../hooks/use-personalization-active';
import { VoiceOutputProvider } from '../hooks/voice-output-context';
import { hasThoughtSteps } from '../utils/build-thought-timeline';
import { ApprovalCardRenderer } from './approval-card-renderer';
import { BranchNavigator } from './branch-navigator';
import { CollapsibleSystemMessage } from './collapsible-system-message';
import { InlineEditInput } from './inline-edit-input';
import { InlineMemoryProposals } from './inline-memory-proposals';
import { MessageBubble } from './message-bubble';
import { ThinkingIndicator } from './thought-timeline';
import { VirtualizedChatMessageList } from './virtualized-chat-message-list';
import { VoiceOutputAnnouncer } from './voice-output-announcer';

/**
 * Opt-in flag for the experimental windowed (virtualized) message list. Off by
 * default — the proven non-virtualized path (with the min-height anchor +
 * content-visibility) ships to everyone. Flip in the browser console with
 * `localStorage.tale_virtualized_messages = '1'` (then reload) to validate.
 * Read once at mount so it can't flip mid-session and break the virtualizer.
 */
function useVirtualizedMessagesFlag(): boolean {
  const [enabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('tale_virtualized_messages') === '1';
    } catch {
      return false;
    }
  });
  return enabled;
}

/**
 * Compute the response area min-height so that scrolling to bottom
 * positions the last user message at the viewport top.
 *
 * Formula: viewport - footer - userMsg - gap - contentPadding - topInset
 *
 * This matches assistant-ui's ViewportSlack pattern.
 * The topInset ensures the user message has breathing room from the
 * viewport top edge (not flush against the toolbar).
 */
const TOP_INSET = 16;

/**
 * For short user messages (≤ CLAMP_THRESHOLD): compute min-height so
 * the user message anchors at the viewport top.
 * For tall user messages (> CLAMP_THRESHOLD): return 0 — content flows
 * naturally, no artificial white gap below the message.
 */
const CLAMP_THRESHOLD = 160; // ~10em

/**
 * Native "virtualization-lite": history messages (everything before the
 * current turn) skip layout & paint while off-screen, so a long thread doesn't
 * pay to render hundreds of bubbles. `contain-intrinsic-size: auto <estimate>`
 * supplies a placeholder height and remembers each bubble's real size after its
 * first render, so scrollbar/position stay stable. Applied ONLY to history —
 * the active turn (last user message + streaming response) stays fully
 * rendered so the min-height/anchor measurement is exact. Unsupported browsers
 * (older Safari/Firefox) just render normally — pure progressive enhancement.
 */
const HISTORY_CONTENT_VISIBILITY =
  '[content-visibility:auto] [contain-intrinsic-size:auto_200px]';

function computeResponseMinHeight(
  container: HTMLElement,
  responseArea: HTMLElement,
  userMsg: HTMLElement | null,
): number {
  if (!userMsg) return 0;

  const userMsgH = userMsg.getBoundingClientRect().height;

  // Tall user messages: skip min-height — just scroll to bottom naturally.
  if (userMsgH > CLAMP_THRESHOLD) return 0;

  const footer = container.querySelector('[class*="sticky"]');
  const footerH =
    footer instanceof HTMLElement ? footer.getBoundingClientRect().height : 0;
  const flexParent = responseArea.parentElement;
  const gap = flexParent
    ? parseFloat(getComputedStyle(flexParent).gap) || 0
    : 0;
  // Walk up from responseArea to find the content wrapper (direct child of
  // container). Using container.firstElementChild is unreliable because
  // conditional siblings (e.g. budget warning banner) can appear before the
  // content wrapper when there is no threadId.
  let contentWrapper: HTMLElement | null = responseArea;
  while (contentWrapper && contentWrapper.parentElement !== container) {
    contentWrapper = contentWrapper.parentElement;
  }
  const padBottom = contentWrapper
    ? parseFloat(getComputedStyle(contentWrapper).paddingBottom) || 0
    : 0;

  return Math.max(
    0,
    container.clientHeight - footerH - userMsgH - gap - padBottom - TOP_INSET,
  );
}

interface ChatMessagesProps {
  items: ChatItem[];
  threadId: string | undefined;
  organizationId: string;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  loadMore: (numItems: number) => void;
  isLoading: boolean;
  lastUserMessageRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  activeApproval: ChatItem | null;
  forkedMessageCount?: number;
  lastForkedMessageOrder?: number;
  forkedAt?: number;
  forkedFromShare?: boolean;
  onHumanInputResponseSubmitted?: () => void;
  onSendFollowUp?: (message: string) => void;
  onSendMessage?: (message: string) => void;
  onEditMessage?: (messageId: string, content: string) => void;
  onForkAtMessage?: (messageId: string) => void;
  onSavePrompt?: (messageId: string, content: string) => void;
  onUnsavePrompt?: (messageId: string) => void;
  /** Map of messageId → promptId for messages that have been saved as prompts. */
  savedMessageMap?: Map<string, string>;
  onRetry?: () => void;
  editingMessageId?: string;
  editingMessageContent?: string;
  onEditSubmit?: (newContent: string) => Promise<void>;
  onEditCancel?: () => void;
  hideBranchNavigator?: boolean;
  hideFeedback?: boolean;
}

/**
 * Renders the chat message list using assistant-ui's scroll pattern:
 *
 * - Messages render in a flex column
 * - The "response area" (everything after the last user message) gets a
 *   dynamic min-height so that scrolling to bottom naturally positions
 *   the user message at the viewport top.
 * - As the AI response grows and exceeds viewport height, min-height
 *   becomes irrelevant — no empty space at the bottom.
 *
 * Min-height is computed in two phases:
 * 1. useLayoutEffect: approximate value before paint (prevents flash)
 * 2. ResizeObserver: accurate correction after layout completes
 */
export function ChatMessages({
  items,
  threadId,
  organizationId,
  canLoadMore,
  isLoadingMore,
  loadMore,
  isLoading,
  lastUserMessageRef,
  containerRef,
  activeApproval,
  forkedMessageCount,
  lastForkedMessageOrder,
  forkedAt,
  forkedFromShare,
  onHumanInputResponseSubmitted,
  onSendFollowUp,
  onSendMessage,
  onEditMessage,
  onForkAtMessage,
  onSavePrompt,
  onUnsavePrompt,
  savedMessageMap,
  onRetry,
  editingMessageId,
  editingMessageContent,
  onEditSubmit,
  onEditCancel,
  hideBranchNavigator,
  hideFeedback,
}: ChatMessagesProps) {
  const { t } = useT('chat');
  const messageHistoryLabelId = useId();
  const useVirtual = useVirtualizedMessagesFlag();
  const { branches, activeBranchThreadId } = useBranchContext();
  const editInputScrollRef = useRef<HTMLDivElement>(null);

  // Subscribe once to pending memory proposals for this thread and
  // group them by `sourceMessageId`. Each card is rendered under the
  // assistant bubble whose id matches — never under a different
  // bubble. While the agent is still streaming, `sourceMessageId`
  // briefly holds the AI SDK toolCallId (a temporary correlation key
  // written by `propose_memory`); the post-generation resolver
  // overwrites it with the real assistant message id, at which point
  // reactivity drops the card into place. Rows whose
  // `sourceMessageId` never resolves to a visible message id (e.g.
  // generation crashed before the resolver ran) stay invisible here
  // and remain manageable from /settings/personalization.
  const personalizationActive = usePersonalizationActiveForThread(
    threadId,
    organizationId,
  );
  const pendingMemories = useQuery(
    api.user_memories.queries.listPendingMemories,
    personalizationActive.memories && threadId ? { threadId } : 'skip',
  );

  const pendingMemoriesByMessageId = useMemo(() => {
    const map = new Map<string, Doc<'userMemories'>[]>();
    if (!pendingMemories || pendingMemories.length === 0) return map;
    for (const m of pendingMemories) {
      if (typeof m.sourceMessageId !== 'string') continue;
      const existing = map.get(m.sourceMessageId);
      if (existing) existing.push(m);
      else map.set(m.sourceMessageId, [m]);
    }
    return map;
  }, [pendingMemories]);

  // Scroll the inline edit input into view when it appears.
  // Double-RAF ensures the ChatInterface scroll system (MutationObserver /
  // ResizeObserver) fires first, then we override with the correct position.
  useEffect(() => {
    if (!editingMessageId) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        editInputScrollRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
    });
  }, [editingMessageId]);
  const responseAreaRef = useRef<HTMLDivElement>(null);

  // Split items: find the last user message index for layout purposes.
  const lastUserIdx = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.type === 'message' && item.data.role === 'user') return i;
    }
    return -1;
  }, [items]);

  const lastUserMessageKey = useMemo(() => {
    if (lastUserIdx < 0) return null;
    const item = items[lastUserIdx];
    return item.type === 'message' ? item.data.key : null;
  }, [items, lastUserIdx]);

  // Only show the retry button on the latest failed assistant message
  // to avoid retrying the wrong turn when multiple messages have failed.
  const latestFailedAssistantKey = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (
        item.type === 'message' &&
        item.data.role === 'assistant' &&
        item.data.isFailed
      ) {
        return item.data.key;
      }
    }
    return null;
  }, [items]);

  const prevMinHeightRef = useRef('');
  // Tracks the pending key so the last user message keeps a stable React key
  // across the pending→real swap (prevents DOM teardown/rebuild flicker).
  const prevPendingKeyRef = useRef<string | null>(null);
  // Maps a real message key → the pending key it replaced, so the bubble keeps
  // that key PERMANENTLY (not just while it's the last user message). Without
  // this the key reverts on the next send → an unnecessary remount; and a
  // dangling prevPendingKeyRef could bleed a thread-A key onto thread-B's last
  // user message. Reset on thread switch (below).
  const pendingToRealKeyRef = useRef(new Map<string, string>());

  // Min-height computation: set before paint so the response area fills the
  // viewport below the user message. Scrolling is handled by ChatInterface's
  // content ResizeObserver + scroll-intent ref (assistant-ui pattern).
  useLayoutEffect(() => {
    const container = containerRef.current;
    const responseArea = responseAreaRef.current;
    if (!container || !responseArea) return undefined;

    const next = `${computeResponseMinHeight(container, responseArea, lastUserMessageRef.current)}px`;
    prevMinHeightRef.current = next;
    responseArea.style.minHeight = next;

    // Accurate correction after layout completes (footer may not have its
    // final size during useLayoutEffect).
    const frame = requestAnimationFrame(() => {
      if (!container || !responseArea) return;
      const corrected = `${computeResponseMinHeight(container, responseArea, lastUserMessageRef.current)}px`;
      if (prevMinHeightRef.current !== corrected) {
        prevMinHeightRef.current = corrected;
        responseArea.style.minHeight = corrected;
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [lastUserMessageKey, containerRef, lastUserMessageRef]);

  // Keep min-height updated on window/footer resize.
  // Guards against feedback loops by skipping when the value is unchanged.
  // Uses a rAF guard to coalesce rapid-fire ResizeObserver callbacks into
  // a single layout recalculation per frame, preventing scrolling jitter.
  useEffect(() => {
    const container = containerRef.current;
    const responseArea = responseAreaRef.current;
    if (!container || !responseArea) return undefined;

    let rafId: number | null = null;

    const update = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const next = `${computeResponseMinHeight(container, responseArea, lastUserMessageRef.current)}px`;
        if (prevMinHeightRef.current === next) return;
        prevMinHeightRef.current = next;
        responseArea.style.minHeight = next;
      });
    };

    const ro = new ResizeObserver(update);
    ro.observe(container);
    const footer = container.querySelector('[class*="sticky"]');
    if (footer instanceof HTMLElement) ro.observe(footer);

    return () => {
      ro.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [containerRef, lastUserMessageRef]);

  // Identity-based freshness snapshot: capture the set of message IDs
  // present on this list's first non-empty render. Anything that appears
  // in `items` after that snapshot is "fresh since mount" — i.e. it
  // arrived via subscription during this user-observation session, not
  // as part of the initial thread-history load. The voice-output chunker
  // uses this to decide whether to fire `synthesizeChunk` (fresh) or
  // skip (history). Identity-based (not wall-clock-based) so it's immune
  // to server/client clock skew, multi-tab inconsistency, and the
  // `_creationTime` vs `Date.now()` direction mismatch that broke the
  // prior `mountTimeRef` approach.
  //
  // Per-thread reset: when `threadId` changes, the prior snapshot is no
  // longer meaningful — every message in the new thread is "history" from
  // this mount's perspective. Reset the snapshot ref so the next non-empty
  // `items` tick re-captures.
  const initialMessageIdsRef = useRef<Set<string> | null>(null);
  const snapshotThreadIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (snapshotThreadIdRef.current !== threadId) {
      initialMessageIdsRef.current = null;
      // Reset key-stabilization state too, or a prior thread's pending key
      // could be reused as another thread's last-user-message key (DOM/state
      // bleed across threads, since ChatMessages stays mounted on switch).
      prevPendingKeyRef.current = null;
      pendingToRealKeyRef.current.clear();
      snapshotThreadIdRef.current = threadId;
    }
    if (initialMessageIdsRef.current === null && items.length > 0) {
      const ids = new Set<string>();
      for (const item of items) {
        if (item.type === 'message') ids.add(item.data.id);
      }
      initialMessageIdsRef.current = ids;
    }
  }, [items, threadId]);

  const isFreshSinceMount = (messageId: string): boolean => {
    const snapshot = initialMessageIdsRef.current;
    // Before the snapshot is captured (very first render with empty
    // items), treat nothing as fresh so we don't fire synthesis for
    // bubbles that may turn out to be history once the subscription
    // settles. The snapshot effect runs on the next tick.
    if (snapshot === null) return false;
    return !snapshot.has(messageId);
  };

  // Build a set of forkOrder values where branch navigators should appear.
  // Two cases:
  // 1. Current thread has child branches → show navigator at child's forkOrder
  // 2. Current thread IS a branch → show navigator at its own forkOrder (to switch siblings)
  const forkPointOrders = useMemo(() => {
    if (!activeBranchThreadId) return new Set<number>();
    const orders = new Set<number>();
    for (const b of branches) {
      if (b.parentThreadId === activeBranchThreadId) {
        orders.add(b.forkOrder);
      }
      if (b.branchThreadId === activeBranchThreadId) {
        orders.add(b.forkOrder);
      }
    }
    return orders;
  }, [branches, activeBranchThreadId]);

  const renderMessage = (item: ChatItem, isHistory: boolean) => {
    if (item.type !== 'message') return null;

    const message = item.data;

    if (message.role === 'system' && message.systemMessageDisplay) {
      if (message.systemMessageDisplay === 'pill') {
        return (
          <div key={message.key} className="flex justify-end">
            <div className="bg-primary/10 text-primary flex items-center gap-2 rounded-full px-4 py-2 text-sm">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              <span>{message.systemMessageBody ?? message.content}</span>
            </div>
          </div>
        );
      }

      const content = message.systemMessageBody ?? message.content;
      const lines = content.split('\n').filter((l) => l.trim() !== '');
      const isShort = lines.length <= 2;

      if (
        isShort &&
        (message.systemMessageDisplay === 'warning' ||
          message.systemMessageDisplay === 'error')
      ) {
        return (
          <div
            key={message.key}
            className={`flex items-center gap-1.5 px-4 py-1 text-xs ${message.systemMessageDisplay === 'error' ? 'text-destructive' : 'text-warning'}`}
          >
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{content}</span>
          </div>
        );
      }

      return (
        <CollapsibleSystemMessage
          key={message.key}
          content={content}
          variant={message.systemMessageDisplay}
        />
      );
    }

    const hasContent = message.content !== '';
    const hasAttachments =
      (message.attachments && message.attachments.length > 0) ||
      (message.fileParts && message.fileParts.length > 0);
    // Assistant messages with reasoning/tool activity render early so the live
    // thought-process timeline is visible before any answer text arrives.
    // `hasThoughtSteps` is LAST so the cheap boolean checks short-circuit first
    // — it scans the parts array, and ChatMessages re-renders every streamed
    // token, so we skip that scan for any message already shown via content.
    const shouldShow =
      message.role === 'user' ||
      hasContent ||
      hasAttachments ||
      message.isAborted ||
      hasThoughtSteps(message.parts);

    if (!shouldShow) return null;

    const isLastUserMessage = message.key === lastUserMessageKey;

    // Stable key across the pending→real swap so React updates in place (no DOM
    // teardown). When the last user message's real key first appears, record
    // realKey→pendingKey ONCE; then resolve every message's key through the map
    // so the bubble keeps its pending key PERMANENTLY (it doesn't revert on the
    // next send → no later remount). In virtualized mode we use the raw key so
    // the inner React key always matches the virtualizer's wrapper key.
    let reactKey = message.key;
    if (!useVirtual) {
      if (isLastUserMessage) {
        if (message.key.startsWith('pending-')) {
          prevPendingKeyRef.current = message.key;
        } else if (prevPendingKeyRef.current) {
          pendingToRealKeyRef.current.set(
            message.key,
            prevPendingKeyRef.current,
          );
          prevPendingKeyRef.current = null;
        }
      }
      reactKey = pendingToRealKeyRef.current.get(message.key) ?? message.key;
    }

    const isUserMessage = message.role === 'user';
    const hasBranches =
      isUserMessage &&
      message.order !== undefined &&
      forkPointOrders.has(message.order);

    const isEditing = isUserMessage && message.id === editingMessageId;

    const inlineProposals =
      !isUserMessage && pendingMemoriesByMessageId.get(message.id);

    return (
      <div
        key={reactKey}
        // Stable anchor for load-more prepend scroll preservation (use-chat-scroll
        // restores a visible message's position rather than a scrollHeight delta).
        data-message-key={reactKey}
        ref={isLastUserMessage ? lastUserMessageRef : undefined}
        className={cn(
          isLastUserMessage && 'scroll-mt-6',
          // Off-screen history skips layout/paint (see constant). Never applied
          // to the last user message or the active response area.
          isHistory && !isLastUserMessage && HISTORY_CONTENT_VISIBILITY,
        )}
      >
        {isEditing && onEditSubmit && onEditCancel ? (
          <div className="flex justify-end" ref={editInputScrollRef}>
            <div className="w-full max-w-[85%]">
              <InlineEditInput
                messageContent={editingMessageContent ?? message.content}
                onSubmit={onEditSubmit}
                onCancel={onEditCancel}
              />
            </div>
          </div>
        ) : (
          <>
            <MessageBubble
              message={{
                ...message,
                role: isUserMessage ? 'user' : 'assistant',
                threadId: threadId,
              }}
              organizationId={organizationId}
              isFreshSinceMount={isFreshSinceMount(message.id)}
              hideFeedback={hideFeedback}
              onSendFollowUp={onSendFollowUp}
              onRetry={
                message.isFailed && message.key === latestFailedAssistantKey
                  ? onRetry
                  : undefined
              }
              onEdit={isUserMessage ? onEditMessage : undefined}
              onFork={onForkAtMessage}
              onSavePrompt={isUserMessage ? onSavePrompt : undefined}
              onUnsavePrompt={isUserMessage ? onUnsavePrompt : undefined}
              isSavedPrompt={
                isUserMessage && savedMessageMap
                  ? savedMessageMap.has(message.id)
                  : false
              }
              toolbarExtra={
                !hideBranchNavigator &&
                hasBranches &&
                message.order !== undefined ? (
                  <BranchNavigator forkOrder={message.order} />
                ) : undefined
              }
            />
            {inlineProposals && (
              <InlineMemoryProposals memories={inlineProposals} />
            )}
          </>
        )}
      </div>
    );
  };

  // Compute fork divider position: after the last forked message.
  // Priority: forkedAt (timestamp) > lastForkedMessageOrder > forkedMessageCount.
  const forkDividerAfterIdx = useMemo(() => {
    // Preferred: timestamp-based — all copied messages have _creationTime <= forkedAt
    if (forkedAt !== undefined) {
      let lastMatch = -1;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (
          item.type === 'message' &&
          item.data._creationTime !== undefined &&
          item.data._creationTime <= forkedAt
        ) {
          lastMatch = i;
        }
      }
      if (lastMatch >= 0) return lastMatch;
    }
    // Fallback: order-based for threads created before forkedAt existed
    if (lastForkedMessageOrder !== undefined) {
      let lastMatch = -1;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (
          item.type === 'message' &&
          item.data.order !== undefined &&
          item.data.order <= lastForkedMessageOrder
        ) {
          lastMatch = i;
        }
      }
      if (lastMatch >= 0) return lastMatch;
    }
    // Fallback: count-based for oldest threads
    if (!forkedMessageCount || forkedMessageCount <= 0) return -1;
    let msgCount = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type === 'message') {
        msgCount++;
        if (msgCount === forkedMessageCount) return i;
      }
    }
    return -1;
  }, [items, forkedAt, lastForkedMessageOrder, forkedMessageCount]);

  const forkDivider =
    forkDividerAfterIdx >= 0 ? (
      <div
        key="fork-divider"
        className="flex items-center gap-3 py-2"
        role="separator"
      >
        <div className="bg-border h-px flex-1" />
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Lock className="size-3" />
          {forkedFromShare ? t('shareBoundary') : t('forkBoundary')}
        </span>
        <div className="bg-border h-px flex-1" />
      </div>
    ) : null;

  const renderItemWithDivider = (item: ChatItem, idx: number) => {
    // "History" = before the current turn's user message. Those bubbles get
    // content-visibility so off-screen history doesn't pay layout/paint — but
    // NOT in virtualized mode, where the virtualizer already windows the DOM
    // and content-visibility would make off-screen-but-overscanned items
    // mis-measure.
    const isHistory = !useVirtual && lastUserIdx >= 0 && idx < lastUserIdx;
    const rendered = renderMessage(item, isHistory);
    if (idx === forkDividerAfterIdx) {
      return (
        <div key={`divider-wrap-${idx}`}>
          {rendered}
          {forkDivider}
        </div>
      );
    }
    return rendered;
  };

  const beforeItems = lastUserIdx >= 0 ? items.slice(0, lastUserIdx) : items;
  const lastUserItem = lastUserIdx >= 0 ? items[lastUserIdx] : null;
  const afterItems = lastUserIdx >= 0 ? items.slice(lastUserIdx + 1) : [];

  // True once an assistant bubble for this turn renders something (answer text,
  // attachments, an abort/fail notice, or a thought-process timeline). Gates
  // the post-send "Thinking…" fallback so it only fills the gap between send
  // and the assistant message appearing — the in-bubble timeline takes over
  // the moment reasoning or tools arrive.
  const hasRenderableAssistantResponse = afterItems.some(
    (it) =>
      it.type === 'message' &&
      it.data.role === 'assistant' &&
      (!!it.data.content ||
        it.data.isAborted ||
        it.data.isFailed ||
        hasThoughtSteps(it.data.parts)),
  );

  // Shared between the virtualized and non-virtualized paths.
  const loadMoreHeader =
    canLoadMore || isLoadingMore ? (
      <div className="flex justify-center py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => loadMore(50)}
          disabled={isLoadingMore}
          className="text-muted-foreground hover:text-foreground"
        >
          {isLoadingMore ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('history.loading')}
            </>
          ) : (
            t('loadOlderMessages')
          )}
        </Button>
      </div>
    ) : null;

  // Post-send gap affordance: shown only until the assistant message appears
  // with its in-bubble thought-process timeline. The ThinkingIndicator has no
  // live region of its own (to avoid nested-live-region double-announce), so it
  // must sit inside an aria-live wrapper to be announced.
  const responseFooterLive =
    isLoading && !hasRenderableAssistantResponse ? (
      <ThinkingIndicator className="px-4 py-3" />
    ) : null;
  // Approval cards own internal live regions for their executing/error
  // sub-states (e.g. workflow-run-approval-card's role=status, the role=alert
  // error blocks). They must therefore render OUTSIDE any ancestor aria-live
  // region, or those sub-state regions would nest (the nested-live-region
  // anti-pattern). In the non-virtual path the root role=log aria-live=polite
  // wraps everything — that nesting is pre-existing there and out of scope — so
  // the card's initial pending body is announced. In the virtualized path the
  // card renders bare (root log has no aria-live), so its pending body is not
  // auto-announced; an accepted limitation of the experimental windowed path.
  const responseFooterStatic = activeApproval ? (
    <ApprovalCardRenderer
      item={activeApproval}
      organizationId={organizationId}
      onHumanInputResponseSubmitted={onHumanInputResponseSubmitted}
      onSendMessage={onSendMessage}
    />
  ) : null;

  if (useVirtual) {
    return (
      <VoiceOutputProvider threadId={threadId}>
        <VoiceOutputAnnouncer />
        <VirtualizedChatMessageList
          items={items}
          containerRef={containerRef}
          renderItem={renderItemWithDivider}
          labelId={messageHistoryLabelId}
          header={
            <>
              <h2 id={messageHistoryLabelId} className="sr-only">
                {t('aria.messageHistory')}
              </h2>
              {loadMoreHeader}
              <div className="h-6" aria-hidden="true" />
            </>
          }
          footer={
            // The virtualized root log has NO aria-live (it would announce
            // windowing churn), so the thinking affordance gets its own scoped
            // polite region here. The region wrapper is ALWAYS mounted (only its
            // content is conditional) so a later ThinkingIndicator insertion is
            // a mutation of an already-registered region — content inserted in
            // the same DOM mutation as its aria-live container announces
            // unreliably across screen readers. ThinkingIndicator has no
            // internal live region, so nothing nests. The approval card renders
            // BARE (it owns internal sub-state live regions; see above). No
            // parent `gap` — the live wrapper carries its own bottom padding
            // only when populated, so an empty wrapper adds no phantom gap.
            <div className="flex flex-col pb-2">
              <div
                aria-live="polite"
                className={responseFooterLive ? 'pb-3' : undefined}
              >
                {responseFooterLive}
              </div>
              {responseFooterStatic}
            </div>
          }
        />
      </VoiceOutputProvider>
    );
  }

  return (
    <VoiceOutputProvider threadId={threadId}>
      {/* Sibling of the chat log so voice-mode state transitions are
          announced exactly once, not amplified by the parent log's
          aria-live region. */}
      <VoiceOutputAnnouncer />
      <div
        className="mx-auto flex w-full max-w-(--chat-max-width) flex-col"
        role="log"
        aria-live="polite"
        aria-labelledby={messageHistoryLabelId}
      >
        <h2 id={messageHistoryLabelId} className="sr-only">
          {t('aria.messageHistory')}
        </h2>
        <div className="flex flex-col gap-3 pt-6">
          {loadMoreHeader}

          {/* Messages before the last user message */}
          <div className="flex flex-col gap-3">
            {beforeItems.map((item, i) => renderItemWithDivider(item, i))}
          </div>

          {/* Last user message */}
          {lastUserItem && renderItemWithDivider(lastUserItem, lastUserIdx)}

          {/* Response area: min-height fills viewport so scroll-to-bottom
            positions the user message at the top. When AI response exceeds
            viewport height, min-height becomes irrelevant. */}
          <div
            ref={responseAreaRef}
            className="flex shrink-0 flex-col gap-3 [overflow-anchor:none]"
          >
            {afterItems.map((item, i) =>
              renderItemWithDivider(item, lastUserIdx + 1 + i),
            )}
            {/* Non-virtualized path: the root already is role="log"
                aria-live="polite", so both pieces render inside it as before. */}
            {responseFooterLive}
            {responseFooterStatic}
          </div>
        </div>
      </div>
    </VoiceOutputProvider>
  );
}
