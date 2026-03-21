'use client';

import type { UIMessage } from '@convex-dev/agent/react';

import { Loader2, CheckCircle2 } from 'lucide-react';
import {
  useMemo,
  useRef,
  useLayoutEffect,
  useEffect,
  type RefObject,
} from 'react';

import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

import type { ChatItem } from '../hooks/use-merged-chat-items';

import { ApprovalCardRenderer } from './approval-card-renderer';
import { CollapsibleSystemMessage } from './collapsible-system-message';
import { MessageBubble } from './message-bubble';
import { ThinkingAnimation } from './thinking-animation';

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

function computeResponseMinHeight(
  container: HTMLElement,
  responseArea: HTMLElement,
  userMsg: HTMLElement | null,
): number {
  if (!userMsg) return 0;

  const footer = container.querySelector('[class*="sticky"]');
  const footerH =
    footer instanceof HTMLElement ? footer.getBoundingClientRect().height : 0;
  const userMsgH = userMsg.getBoundingClientRect().height;
  const flexParent = responseArea.parentElement;
  const gap = flexParent
    ? parseFloat(getComputedStyle(flexParent).gap) || 0
    : 0;
  const contentWrapper = container.firstElementChild;
  const padBottom =
    contentWrapper instanceof HTMLElement
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
  onHumanInputResponseSubmitted?: () => void;
  onSendFollowUp?: (message: string) => void;
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
  onHumanInputResponseSubmitted,
  onSendFollowUp,
}: ChatMessagesProps) {
  const { t } = useT('chat');
  const responseAreaRef = useRef<HTMLDivElement>(null);

  const lastUserMessageKey = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.type === 'message' && item.data.role === 'user') {
        return item.data.key;
      }
    }
    return null;
  }, [items]);

  const prevLastUserKeyRef = useRef<string | null>(null);

  // Phase 1: Approximate min-height before paint + scroll on send.
  // Footer may not have its final size during useLayoutEffect, so the
  // value can be slightly off. Phase 2 (rAF) corrects it immediately.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const responseArea = responseAreaRef.current;
    if (container && responseArea) {
      responseArea.style.minHeight = `${computeResponseMinHeight(container, responseArea, lastUserMessageRef.current)}px`;
    }

    // Scroll to bottom on new pending message or pending→real key swap.
    const prev = prevLastUserKeyRef.current;
    const isNewPending =
      lastUserMessageKey?.startsWith('pending-') && lastUserMessageKey !== prev;
    const isPendingSwap =
      prev?.startsWith('pending-') &&
      lastUserMessageKey &&
      !lastUserMessageKey.startsWith('pending-');

    if ((isNewPending || isPendingSwap) && container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
    }
    prevLastUserKeyRef.current = lastUserMessageKey;

    // Phase 2: Accurate correction after layout completes (footer has
    // final size). Runs on every lastUserMessageKey change, covering
    // thread navigation and message sends.
    const frame = requestAnimationFrame(() => {
      if (!container || !responseArea) return;
      const atBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <=
        2;

      responseArea.style.minHeight = `${computeResponseMinHeight(container, responseArea, lastUserMessageRef.current)}px`;

      if (atBottom) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'instant',
        });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [lastUserMessageKey, containerRef, lastUserMessageRef]);

  // Phase 3: Keep min-height updated on window/footer resize.
  useEffect(() => {
    const container = containerRef.current;
    const responseArea = responseAreaRef.current;
    if (!container || !responseArea) return;

    const update = () => {
      const atBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <=
        2;

      responseArea.style.minHeight = `${computeResponseMinHeight(container, responseArea, lastUserMessageRef.current)}px`;

      if (atBottom) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'instant',
        });
      }
    };

    const ro = new ResizeObserver(update);
    ro.observe(container);
    const footer = container.querySelector('[class*="sticky"]');
    if (footer instanceof HTMLElement) ro.observe(footer);

    return () => ro.disconnect();
  }, [containerRef, lastUserMessageRef]);

  // Split items into: everything before & including the last user message,
  // and everything after (the "response area").
  const lastUserIdx = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.type === 'message' && item.data.role === 'user') return i;
    }
    return -1;
  }, [items]);

  const renderMessage = (item: ChatItem) => {
    if (item.type !== 'message') return null;

    const message = item.data;

    if (message.isHumanInputResponse && message.role === 'system') {
      const match = message.content.match(
        /^User responded to question "(.*?)": ([\s\S]+)$/,
      );
      const response = match?.[2] ?? message.content;

      return (
        <div key={message.key} className="flex justify-end">
          <div className="bg-primary/10 text-primary flex items-center gap-2 rounded-full px-4 py-2 text-sm">
            <CheckCircle2 className="size-4" />
            <span>{response}</span>
          </div>
        </div>
      );
    }

    if (message.role === 'system' && !message.isHumanInputResponse) {
      return (
        <CollapsibleSystemMessage key={message.key} content={message.content} />
      );
    }

    const shouldShow =
      message.role === 'user' || message.content !== '' || message.isAborted;

    if (!shouldShow) return null;

    const isLastUserMessage = message.key === lastUserMessageKey;

    return (
      <div
        key={message.key}
        ref={isLastUserMessage ? lastUserMessageRef : undefined}
        className={isLastUserMessage ? 'scroll-mt-6' : undefined}
      >
        <MessageBubble
          message={{
            ...message,
            role: message.role === 'user' ? 'user' : 'assistant',
            threadId: threadId,
          }}
          onSendFollowUp={onSendFollowUp}
        />
      </div>
    );
  };

  const beforeItems = lastUserIdx >= 0 ? items.slice(0, lastUserIdx) : items;
  const lastUserItem = lastUserIdx >= 0 ? items[lastUserIdx] : null;
  const afterItems = lastUserIdx >= 0 ? items.slice(lastUserIdx + 1) : [];

  return (
    <div
      className="mx-auto flex w-full max-w-(--chat-max-width) flex-col"
      role="log"
      aria-live="polite"
      aria-label={t('aria.messageHistory')}
    >
      <div className="flex flex-col gap-4 pt-10">
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
        {beforeItems.map(renderMessage)}

        {/* Last user message */}
        {lastUserItem && renderMessage(lastUserItem)}

        {/* Response area: min-height fills viewport so scroll-to-bottom
            positions the user message at the top. When AI response exceeds
            viewport height, min-height becomes irrelevant. */}
        <div ref={responseAreaRef} className="flex shrink-0 flex-col gap-4">
          {afterItems.map(renderMessage)}

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
            />
          )}
        </div>
      </div>
    </div>
  );
}
