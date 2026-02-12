'use client';

import { decode } from 'he';
import { Mail, ClipboardList, Sparkles } from 'lucide-react';
import { memo, useRef } from 'react';
import striptags from 'striptags';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { HStack } from '@/app/components/ui/layout/layout';
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

function ConversationsListSkeleton() {
  return (
    <div className="divide-border divide-y border-b">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="p-4">
          <div className="flex items-start gap-3">
            {/* Checkbox */}
            <div className="mt-1 flex items-center">
              <div className="border-muted bg-background size-4 rounded border-2" />
            </div>

            {/* Conversation Details */}
            <div className="min-w-0 flex-1">
              {/* Header with title and timestamp */}
              <div className="mb-1.5 flex items-start justify-between">
                <div className="bg-muted h-4 w-2/3 animate-pulse rounded" />
                <div className="bg-muted ml-4 h-3 w-12 animate-pulse rounded" />
              </div>

              {/* Last message preview */}
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="bg-muted/70 h-4 w-full animate-pulse rounded" />
              </div>

              {/* Badges */}
              <div className="flex gap-2">
                {i % 3 === 0 && (
                  <div className="bg-muted/50 h-5 w-16 animate-pulse rounded-full" />
                )}
                {i % 2 === 0 && (
                  <div className="bg-muted/50 h-5 w-20 animate-pulse rounded-full" />
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface ConversationRowProps {
  conversation: Conversation;
  isSelected: boolean;
  isChecked: boolean;
  onSelect?: (conversation: Conversation) => void;
  onCheck?: (conversationId: string, checked: boolean) => void;
  formatDateSmart: (date: string | Date) => string;
  t: (key: string) => string;
  tDialogs: (key: string) => string;
}

const ConversationRow = memo(function ConversationRow({
  conversation,
  isSelected,
  isChecked,
  onSelect,
  onCheck,
  formatDateSmart,
  t,
  tDialogs,
}: ConversationRowProps) {
  const handleClick = (event: React.MouseEvent) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('[data-state]')
    )
      return;
    onSelect?.(conversation);
  };

  const handleCheckboxChange = (checked: boolean | 'indeterminate') => {
    if (typeof checked === 'boolean') {
      onCheck?.(conversation.id, checked);
    }
  };

  return (
    <button
      type="button"
      className={cn(
        'w-full text-left p-4 hover:bg-secondary/20 cursor-pointer transition-colors relative',
        isSelected && 'bg-muted',
      )}
      onClick={handleClick}
      aria-pressed={isSelected}
    >
      {isSelected && (
        <div className="bg-primary absolute top-0 bottom-0 left-0 w-1" />
      )}
      <div className="flex items-start gap-3">
        <div className="mt-1 flex items-center">
          <Checkbox
            checked={isChecked}
            onCheckedChange={handleCheckboxChange}
            aria-label={tDialogs('selectConversation')}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-start justify-between">
            <h3 className="text-foreground flex-1 truncate text-sm font-medium tracking-tight">
              {conversation?.title || conversation.customer?.name || 'Unknown'}
            </h3>
            <span className="text-muted-foreground ml-4 flex-shrink-0 text-xs font-medium tracking-tight">
              {formatDateSmart(conversation.last_message_at || '')}
            </span>
          </div>

          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-muted-foreground flex-1 truncate text-sm tracking-tight">
              {getLastMessagePreview(conversation)}
            </p>
            {conversation.unread_count > 0 && (
              <div className="text-primary-foreground flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 px-1 py-2 text-xs leading-none">
                {conversation.unread_count}
              </div>
            )}
          </div>

          <HStack gap={2}>
            {(() => {
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
                    {t(priorityConfig[priority].translationKey)}
                  </Badge>
                )
              );
            })()}

            {(() => {
              const conversationType: string | undefined = conversation.type;
              return (
                conversationType &&
                isKeyOf(conversationType, categoryConfig) && (
                  <Badge
                    variant="outline"
                    icon={categoryConfig[conversationType].icon}
                  >
                    {t(categoryConfig[conversationType].translationKey)}
                  </Badge>
                )
              );
            })()}
          </HStack>
        </div>
      </div>
    </button>
  );
});

export function ConversationsList({
  conversations,
  selectedConversationId,
  onConversationSelect,
  onConversationCheck,
  isConversationSelected,
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

  if (conversations === undefined) {
    return <ConversationsListSkeleton />;
  }

  return (
    <div className="divide-border divide-y border-b">
      {conversations.map((conversation) => (
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
    </div>
  );
}
