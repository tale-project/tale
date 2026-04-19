'use client';

import type { UIMessage } from '@convex-dev/agent/react';
import { AlertTriangle, Loader2, CheckCircle2, Lock } from 'lucide-react';
import {
  useId,
  useMemo,
  useRef,
  useLayoutEffect,
  useEffect,
  type RefObject,
} from 'react';

import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

import { useBranchContext } from '../context/branch-context';
import type { ChatItem } from '../hooks/use-merged-chat-items';
import { ApprovalCardRenderer } from './approval-card-renderer';
import { BranchNavigator } from './branch-navigator';
import { CollapsibleSystemMessage } from './collapsible-system-message';
import { InlineEditInput } from './inline-edit-input';
import { MessageBubble } from './message-bubble';
import { ThinkingAnimation } from './thinking-animation';
import { TodoListCard } from './todo-list-card';

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
  activeMessage: UIMessage | undefined;
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
  activeMessage,
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
  const { branches, activeBranchThreadId } = useBranchContext();
  const editInputScrollRef = useRef<HTMLDivElement>(null);

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

  const renderMessage = (item: ChatItem) => {
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
    const shouldShow =
      message.role === 'user' ||
      hasContent ||
      hasAttachments ||
      message.isAborted;

    if (!shouldShow) return null;

    const isLastUserMessage = message.key === lastUserMessageKey;

    // Stable key for the last user message: keep the pending key across
    // the pending→real swap so React updates in place (no DOM teardown).
    let reactKey = message.key;
    if (isLastUserMessage) {
      if (message.key.startsWith('pending-')) {
        prevPendingKeyRef.current = message.key;
      } else if (prevPendingKeyRef.current) {
        reactKey = prevPendingKeyRef.current;
      }
    }

    const isUserMessage = message.role === 'user';
    const hasBranches =
      isUserMessage &&
      message.order !== undefined &&
      forkPointOrders.has(message.order);

    const isEditing = isUserMessage && message.id === editingMessageId;

    return (
      <div
        key={reactKey}
        ref={isLastUserMessage ? lastUserMessageRef : undefined}
        className={isLastUserMessage ? 'scroll-mt-6' : undefined}
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
          <MessageBubble
            message={{
              ...message,
              role: isUserMessage ? 'user' : 'assistant',
              threadId: threadId,
            }}
            organizationId={organizationId}
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
    const rendered = renderMessage(item);
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

  return (
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
        {threadId && (
          <TodoListCard threadId={threadId} className="mx-auto w-full" />
        )}
        {(canLoadMore || isLoadingMore) && (
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
        )}

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

          <div>
            {isLoading && (
              <ThinkingAnimation streamingMessage={activeMessage} />
            )}
          </div>

          {activeApproval && (
            <ApprovalCardRenderer
              item={activeApproval}
              organizationId={organizationId}
              onHumanInputResponseSubmitted={onHumanInputResponseSubmitted}
              onSendMessage={onSendMessage}
            />
          )}
        </div>
      </div>
    </div>
  );
}
