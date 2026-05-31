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

    // Use the displayable message instead
    let content = displayableMessage.content;

    // Remove style and script tags and their contents
    content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
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

    // Strip HTML tags and decode HTML entities
    content = striptags(content).trim();

    // Decode HTML entities (like &nbsp; to space)
    content = decode(content);

    // Clean up extra whitespace
    content = content.replace(/\s+/g, ' ').trim();

    return content;
  }

  // Process the last message (either from customer or sent/delivered)
  let content = lastMessage.content;

  // Remove style and script tags and their contents
  content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
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

  // Strip HTML tags and decode HTML entities
  content = striptags(content).trim();

  // Decode HTML entities (like &nbsp; to space)
  content = decode(content);

  // Clean up extra whitespace
  content = content.replace(/\s+/g, ' ').trim();

  return content;
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
            <SkeletonBox fullWidth>
              {conversation ? (
                conversation.title
              ) : (
                <span className="inline-block w-3/4">&nbsp;</span>
              )}
            </SkeletonBox>
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

  // Loaded but genuinely empty — real empty state, never masked.
  if (conversations !== undefined && conversations.length === 0) {
    return (
      <Center className="flex-1 flex-col px-4 py-16">
        <Inbox className="text-muted-foreground mb-3 size-8" />
        <Text variant="muted">{t('list.empty')}</Text>
      </Center>
    );
  }

  // One real tree, always. While conversations are undefined (loading) no real
  // rows exist, so a few placeholder rows stand in — each ConversationRow
  // masks its own leaves (placeholder mode) inside <Skeletonize loading>.
  const isLoading = conversations === undefined;
  const placeholderCount = Math.min(skeletonRows, 12);

  return (
    <Skeletonize loading={isLoading}>
      <div className="divide-border divide-y border-b">
        {isLoading
          ? Array.from({ length: placeholderCount }).map((_, i) => (
              <ConversationRow key={i} placeholder placeholderIndex={i} />
            ))
          : conversations.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                isSelected={selectedConversationId === conversation.id}
                isChecked={isConversationSelected?.(conversation.id) || false}
                onSelect={onConversationSelect}
                onCheck={onConversationCheck}
                formatDateSmart={formatDateSmart}
                t={stableT}
                tDialogs={stableTDialogs}
              />
            ))}
        {paginationStatus === 'LoadingMore' && (
          <Center className="py-4">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </Center>
        )}
        {(paginationStatus === 'CanLoadMore' ||
          paginationStatus === 'LoadingMore') && (
          <div ref={sentinelRef} className="h-1" aria-hidden="true" />
        )}
      </div>
    </Skeletonize>
  );
}
