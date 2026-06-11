'use client';

import { Badge } from '@tale/ui/badge';
import { Heading } from '@tale/ui/heading';
import { Center, HStack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { decode } from 'he';
import { ClipboardList, Inbox, Loader2, Mail, Sparkles } from 'lucide-react';
import { memo, useCallback, useEffect, useRef } from 'react';
import striptags from 'striptags';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { isKeyOf } from '@/lib/utils/type-guards';

import type { Conversation } from '../types';

// Strip script/style + HTML tags, decode entities, and collapse whitespace
// into a single-line message preview.
const cleanMessagePreview = (raw: string): string => {
  // Remove style and script tags and their contents
  let content = raw.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Insert spaces at HTML line-break or block boundaries before stripping tags
  // This ensures previews reflect natural spacing between paragraphs, breaks, list items, etc.
  content = content
    // Line breaks
    .replace(/<br\s*\/?>(?=\S)/gi, ' ')
    // Closing block-level tags that typically imply a new line
    .replace(
      /<\/(p|div|li|h[1-6]|section|article|header|footer|tr|td|th)>/gi,
      ' ',
    );

  // Strip HTML tags and trim
  content = striptags(content).trim();

  // Decode HTML entities (like &nbsp; to space)
  content = decode(content);

  // Clean up extra whitespace
  return content.replace(/\s+/g, ' ').trim();
};

// Get the last message content and truncate if necessary
const getLastMessagePreview = (conversation: Conversation): string => {
  if (!conversation.messages || conversation.messages.length === 0) {
    return conversation.description;
  }

  // Get the last message
  const lastMessage = conversation.messages[conversation.messages.length - 1];

  // If the latest message is from customer, show it directly
  // If not from customer, only show if status is 'sent' or 'delivered'
  if (
    !lastMessage.isCustomer &&
    lastMessage.status !== 'sent' &&
    lastMessage.status !== 'delivered'
  ) {
    // Find the most recent message that should be displayed
    // Search from the end backwards without modifying the original array
    let displayableMessage = null;
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const msg = conversation.messages[i];
      if (
        msg.isCustomer ||
        msg.status === 'sent' ||
        msg.status === 'delivered'
      ) {
        displayableMessage = msg;
        break;
      }
    }

    if (!displayableMessage) {
      return conversation.description;
    }

    return cleanMessagePreview(displayableMessage.content);
  }

  // Process the last message (either from customer or sent/delivered)
  return cleanMessagePreview(lastMessage.content);
};

interface ConversationsListProps {
  conversations: Conversation[] | undefined;
  selectedConversationId?: string | null;
  onConversationSelect?: (conversation: Conversation) => void;
  onConversationCheck?: (conversationId: string, checked: boolean) => void;
  isConversationSelected?: (conversationId: string) => boolean;
  paginationStatus?:
    | 'LoadingFirstPage'
    | 'CanLoadMore'
    | 'LoadingMore'
    | 'Exhausted';
  loadMore?: (numItems: number) => void;
  /** Number of placeholder rows to render while `conversations` is undefined. */
  skeletonRows?: number;
}

const priorityConfig = {
  high: {
    translationKey: 'priority.high' as const,
    variant: 'destructive' as const,
  },
  medium: {
    translationKey: 'priority.medium' as const,
    variant: 'orange' as const,
  },
  low: {
    translationKey: 'priority.low' as const,
    variant: 'blue' as const,
  },
};

const categoryConfig = {
  'product-recommendation': {
    translationKey: 'category.productRecommendation' as const,
    icon: Sparkles,
  },
  'service-request': {
    translationKey: 'category.serviceRequest' as const,
    icon: Mail,
  },
  'churn-survey': {
    translationKey: 'category.churnSurvey' as const,
    icon: ClipboardList,
  },
};

interface ConversationRowProps {
  conversation?: Conversation;
  isSelected?: boolean;
  isChecked?: boolean;
  onSelect?: (conversation: Conversation) => void;
  onCheck?: (conversationId: string, checked: boolean) => void;
  formatDateSmart?: (date: string | Date) => string;
  t?: (key: string) => string;
  tDialogs?: (key: string) => string;
  /**
   * Placeholder row: no real conversation has loaded yet. Renders the same
   * structure with each dynamic leaf masked. `placeholderIndex` varies which
   * badge slots show so the loading list doesn't look uniform.
   */
  placeholder?: boolean;
  placeholderIndex?: number;
}

const ConversationRow = memo(function ConversationRow({
  conversation,
  isSelected = false,
  isChecked = false,
  onSelect,
  onCheck,
  formatDateSmart,
  t,
  tDialogs,
  placeholder = false,
  placeholderIndex = 0,
}: ConversationRowProps) {
  const { t: tCommon } = useT('common');

  const handleClick = (event: React.MouseEvent) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('[data-state]')
    )
      return;
    if (conversation) onSelect?.(conversation);
  };

  const handleCheckboxChange = (checked: boolean | 'indeterminate') => {
    if (typeof checked === 'boolean' && conversation) {
      onCheck?.(conversation.id, checked);
    }
  };

  return (
    <button
      type="button"
      disabled={placeholder}
      className={cn(
        'w-full text-left px-4 py-2.5 hover:bg-muted cursor-pointer transition-colors relative',
        isSelected && 'bg-muted',
      )}
      onClick={handleClick}
      aria-pressed={isSelected}
    >
      {isSelected && (
        <div className="bg-primary absolute top-0 bottom-0 left-0 w-1" />
      )}
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex items-center">
          <SkeletonBox>
            <Checkbox
              checked={isChecked}
              onCheckedChange={handleCheckboxChange}
              aria-label={tDialogs ? tDialogs('selectConversation') : ''}
            />
          </SkeletonBox>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Heading
                level={3}
                size="sm"
                weight="semibold"
                tracking="tight"
                truncate
                className="flex-1"
              >
                <SkeletonBox>
                  {conversation
                    ? conversation.customer?.name ||
                      conversation?.title ||
                      'Unknown'
                    : 'Conversation name'}
                </SkeletonBox>
              </Heading>
              {conversation && conversation.unread_count > 0 && (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-blue-500"
                  aria-label={tCommon('aria.unread')}
                  role="status"
                />
              )}
            </div>
            <Text
              as="span"
              variant="label-sm"
              className="text-muted-foreground shrink-0 tracking-tight"
            >
              <SkeletonBox>
                {conversation
                  ? formatDateSmart?.(conversation.last_message_at || '')
                  : '5m ago'}
              </SkeletonBox>
            </Text>
          </div>

          <Text variant="muted" truncate className="mb-1.5 tracking-tight">
            {conversation ? (
              <SkeletonBox fullWidth>{conversation.title}</SkeletonBox>
            ) : (
              // Width sits on a wrapper around the box: a narrower placeholder
              // INSIDE a fullWidth box would be ignored by the mask.
              <span className="block w-3/4">
                <SkeletonBox fullWidth>&nbsp;</SkeletonBox>
              </span>
            )}
          </Text>

          <Text variant="caption" truncate className="mb-2 tracking-tight">
            <SkeletonBox fullWidth>
              {conversation ? (
                getLastMessagePreview(conversation)
              ) : (
                <span className="inline-block w-full">&nbsp;</span>
              )}
            </SkeletonBox>
          </Text>

          <HStack gap={2}>
            {conversation
              ? (() => {
                  const priority: string | undefined = conversation.priority;
                  return (
                    priority &&
                    conversation.status === 'open' &&
                    priority !== 'medium' &&
                    isKeyOf(priority, priorityConfig) && (
                      <Badge
                        dot
                        className="min-w-fit"
                        variant={priorityConfig[priority].variant}
                      >
                        {t?.(priorityConfig[priority].translationKey)}
                      </Badge>
                    )
                  );
                })()
              : placeholderIndex % 3 === 0 && (
                  <SkeletonBox>
                    <div className="h-5 w-16 rounded-full" />
                  </SkeletonBox>
                )}

            {conversation
              ? (() => {
                  const conversationType: string | undefined =
                    conversation.type;
                  return (
                    conversationType &&
                    isKeyOf(conversationType, categoryConfig) && (
                      <Badge
                        variant="outline"
                        icon={categoryConfig[conversationType].icon}
                      >
                        {t?.(categoryConfig[conversationType].translationKey)}
                      </Badge>
                    )
                  );
                })()
              : placeholderIndex % 2 === 0 && (
                  <SkeletonBox>
                    <div className="h-5 w-20 rounded-full" />
                  </SkeletonBox>
                )}
          </HStack>
        </div>
      </div>
    </button>
  );
});

const PAGE_SIZE = 30;

export function ConversationsList({
  conversations,
  selectedConversationId,
  onConversationSelect,
  onConversationCheck,
  isConversationSelected,
  paginationStatus,
  loadMore,
  skeletonRows = 12,
}: ConversationsListProps) {
  const { formatDateSmart } = useFormatDate();
  const { t } = useT('conversations');
  const { t: tDialogs } = useT('dialogs');

  const tRef = useRef(t);
  tRef.current = t;
  const tDialogsRef = useRef(tDialogs);
  tDialogsRef.current = tDialogs;

  const stableT = useRef((key: string) => tRef.current(key)).current;
  const stableTDialogs = useRef((key: string) =>
    tDialogsRef.current(key),
  ).current;

  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (
        entries[0]?.isIntersecting &&
        paginationStatus === 'CanLoadMore' &&
        loadMore
      ) {
        loadMore(PAGE_SIZE);
      }
    },
    [paginationStatus, loadMore],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;

    const observer = new IntersectionObserver(handleIntersect, {
      rootMargin: '200px',
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleIntersect]);

  // One real tree, always. Loading, empty and populated states all render
  // inside the SAME <Skeletonize> wrapper so the base layout never shifts
  // between states (mirrors the DataTable body-state pattern):
  //   - loading  → placeholder rows, each ConversationRow masks its own leaves
  //   - empty    → top-anchored empty message in the rows' place (NOT a
  //                vertically-centered block, which would jump the layout)
  //   - data     → real rows
  const isLoading = conversations === undefined;
  const isEmpty = conversations !== undefined && conversations.length === 0;
  const placeholderCount = Math.min(skeletonRows, 12);

  return (
    <Skeletonize
      loading={isLoading}
      // When empty, the wrapper fills the panel's remaining height so the
      // message can sit vertically centered (mirrors the reading pane's
      // centered empty state). Loading/data keep the natural-height,
      // top-anchored rows container below.
      className={cn(isEmpty && 'flex min-h-0 flex-1 flex-col')}
    >
      {isEmpty ? (
        // Centered in the available space, no row dividers/border — it's a
        // message, not a row, so it shouldn't read as a boxed-off list item.
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
          <Inbox className="text-muted-foreground/60 mb-3 size-6" />
          <Text variant="muted">{t('list.empty')}</Text>
        </div>
      ) : (
        <div className="divide-border divide-y border-b">
          <>
            {isLoading
              ? Array.from({ length: placeholderCount }).map((_, i) => (
                  <ConversationRow key={i} placeholder placeholderIndex={i} />
                ))
              : conversations.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    isSelected={selectedConversationId === conversation.id}
                    isChecked={
                      isConversationSelected?.(conversation.id) || false
                    }
                    onSelect={onConversationSelect}
                    onCheck={onConversationCheck}
                    formatDateSmart={formatDateSmart}
                    t={stableT}
                    tDialogs={stableTDialogs}
                  />
                ))}
            {paginationStatus === 'LoadingMore' && (
              <Center className="py-4">
                <Loader2
                  className="text-muted-foreground size-5 animate-spin motion-reduce:animate-none"
                  role="status"
                  aria-label={t('history.loadingMore')}
                />
              </Center>
            )}
            {(paginationStatus === 'CanLoadMore' ||
              paginationStatus === 'LoadingMore') && (
              <div ref={sentinelRef} className="h-1" aria-hidden="true" />
            )}
          </>
        </div>
      )}
    </Skeletonize>
  );
}
