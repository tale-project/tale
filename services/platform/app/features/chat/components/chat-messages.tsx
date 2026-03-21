'use client';

import type { UIMessage } from '@convex-dev/agent/react';

import { Loader2, CheckCircle2 } from 'lucide-react';
import { useMemo, useRef, useLayoutEffect, type RefObject } from 'react';

import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

import type { ChatItem } from '../hooks/use-merged-chat-items';

import { ApprovalCardRenderer } from './approval-card-renderer';
import { CollapsibleSystemMessage } from './collapsible-system-message';
import { MessageBubble } from './message-bubble';
import { ThinkingAnimation } from './thinking-animation';

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
  activeApproval: ChatItem | null;
  onHumanInputResponseSubmitted?: () => void;
  onSendFollowUp?: (message: string) => void;
}

/**
 * Renders the chat message list with a single active approval at the bottom.
 *
 * Uses ChatGPT-style CSS flex layout for scroll behavior:
 * - `min-h-full` ensures the container is at least viewport height
 * - `flex-1` on the inner wrapper stretches to fill, creating natural blank below messages
 * - When content exceeds viewport, min-h-full is irrelevant — no extra blank
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
  activeApproval,
  onHumanInputResponseSubmitted,
  onSendFollowUp,
}: ChatMessagesProps) {
  const { t } = useT('chat');

  const lastUserMessageKey = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.type === 'message' && item.data.role === 'user') {
        return item.data.key;
      }
    }
    return null;
  }, [items]);

  // ChatGPT-style scroll: when user sends a message, add a viewport-height
  // spacer to ensure enough scroll room, then scroll the message to the top.
  // The spacer never shrinks — it stays so the viewport doesn't jump.
  const spacerRef = useRef<HTMLDivElement>(null);
  const prevLastUserKeyRef = useRef<string | null>(null);
  const isUserScrollPinnedRef = useRef(false);

  // When user sends: expand spacer + scroll to top + enable pinning
  useLayoutEffect(() => {
    if (
      lastUserMessageKey &&
      lastUserMessageKey !== prevLastUserKeyRef.current &&
      lastUserMessageKey.startsWith('pending-')
    ) {
      if (spacerRef.current && lastUserMessageRef.current) {
        // Calculate exact spacer needed: just enough to scroll user message to top
        const container = lastUserMessageRef.current.closest(
          '[class*="overflow-y-auto"]',
        );
        if (container) {
          const msgEl = lastUserMessageRef.current;
          const msgTop = msgEl.getBoundingClientRect().top;
          const containerTop = container.getBoundingClientRect().top;
          const offsetInContainer =
            container.scrollTop + (msgTop - containerTop);
          // Account for scroll-margin-top on the message element
          const scrollMargin = parseFloat(
            getComputedStyle(msgEl).scrollMarginTop || '0',
          );
          const needed = Math.max(
            0,
            offsetInContainer -
              scrollMargin +
              container.clientHeight -
              container.scrollHeight,
          );
          spacerRef.current.style.minHeight = `${needed}px`;
        }
      }
      lastUserMessageRef.current?.scrollIntoView({
        block: 'start',
        behavior: 'instant',
      });
      isUserScrollPinnedRef.current = true;
    }
    prevLastUserKeyRef.current = lastUserMessageKey;
  }, [lastUserMessageKey, lastUserMessageRef]);

  // Keep the user message pinned to the top while loading.
  // Re-scrolls on every items/content change to compensate for:
  // - optimistic → real message key swap
  // - ThinkingAnimation appear/disappear
  // - AI streaming content growth that shifts layout above
  useLayoutEffect(() => {
    if (isUserScrollPinnedRef.current && lastUserMessageRef.current) {
      lastUserMessageRef.current.scrollIntoView({
        block: 'start',
        behavior: 'instant',
      });
    }
  }, [items, lastUserMessageRef]);

  // Stop pinning when loading ends
  useLayoutEffect(() => {
    if (!isLoading) {
      isUserScrollPinnedRef.current = false;
    }
  }, [isLoading]);

  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-(--chat-max-width) flex-col"
      role="log"
      aria-live="polite"
      aria-label={t('aria.messageHistory')}
    >
      {/* Inner wrapper: flex-1 stretches to fill, creating natural blank below messages */}
      <div className="flex flex-1 flex-col gap-4 pt-10">
        {/* Load More button for pagination */}
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

        {/* Render messages only (approvals are rendered separately at bottom) */}
        {items.map((item) => {
          if (item.type !== 'message') return null;

          const message = item.data;

          // Render human input response as a special system message
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
              <CollapsibleSystemMessage
                key={message.key}
                content={message.content}
              />
            );
          }

          const shouldShow =
            message.role === 'user' ||
            message.content !== '' ||
            message.isAborted;

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
        })}

        <div>
          {isLoading && <ThinkingAnimation streamingMessage={activeMessage} />}
        </div>

        {/* Single active approval always at the bottom */}
        {activeApproval && (
          <ApprovalCardRenderer
            item={activeApproval}
            organizationId={organizationId}
            onHumanInputResponseSubmitted={onHumanInputResponseSubmitted}
          />
        )}

        {/* Spacer: provides scroll room for scrollIntoView on long conversations.
            Sized by useLayoutEffect on user send, never shrinks. */}
        <div ref={spacerRef} aria-hidden="true" />
      </div>
    </div>
  );
}
