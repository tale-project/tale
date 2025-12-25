'use client';

import { Mail, ClipboardList, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';
import striptags from 'striptags';
import { decode } from 'he';
import { useDateFormat } from '@/hooks/use-date-format';
import type { Conversation } from '../types';
import { Checkbox } from '@/components/ui/checkbox';
import { useT } from '@/lib/i18n';

// Get the last message content and truncate if necessary
const getLastMessagePreview = (conversation: Conversation): string => {
  if (!conversation.messages || conversation.messages.length === 0) {
    return conversation.description;
  }

  // Get the last message
  const lastMessage = conversation.messages[conversation.messages.length - 1];

  // If the latest message is from customer, show it directly
  // If not from customer, only show if status is 'approved' or 'sent'
  if (
    !lastMessage.isCustomer &&
    lastMessage.status !== 'approved' &&
    lastMessage.status !== 'sent'
  ) {
    // Find the most recent message that should be displayed
    // Search from the end backwards without modifying the original array
    let displayableMessage = null;
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const msg = conversation.messages[i];
      if (
        msg.isCustomer ||
        msg.status === 'approved' ||
        msg.status === 'sent'
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

  // Process the last message (either from customer or approved/sent)
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
  conversations: Conversation[];
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

export default function ConversationsList({
  conversations,
  selectedConversationId,
  onConversationSelect,
  onConversationCheck,
  isConversationSelected,
}: ConversationsListProps) {
  const { formatDateSmart } = useDateFormat();
  const { t } = useT('conversations');
  const { t: tDialogs } = useT('dialogs');
  const handleConversationClick = (
    conversation: Conversation,
    event: React.MouseEvent,
  ) => {
    // Prevent conversation selection if clicking on checkbox
    if ((event.target as HTMLElement).closest('[data-state]')) {
      return;
    }
    onConversationSelect?.(conversation);
  };

  const handleKeyDown = (
    conversation: Conversation,
    event: React.KeyboardEvent,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onConversationSelect?.(conversation);
    }
  };

  const handleCheckboxChange = (
    conversationId: string,
    checked: boolean | 'indeterminate',
  ) => {
    if (typeof checked === 'boolean') {
      onConversationCheck?.(conversationId, checked);
    }
  };

  return (
    <div className="divide-y divide-border border-b">
      {conversations.map((conversation) => (
        <div
          key={conversation.id}
          className={cn(
            'p-4 hover:bg-secondary/20 cursor-pointer transition-colors relative',
            selectedConversationId === conversation.id && 'bg-muted',
          )}
          onClick={(event) => handleConversationClick(conversation, event)}
          onKeyDown={(event) => handleKeyDown(conversation, event)}
          tabIndex={0}
          role="button"
          aria-pressed={selectedConversationId === conversation.id}
        >
          {/* Blue indicator for selected conversation - no layout shift */}
          {selectedConversationId === conversation.id && (
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
          )}
          <div className="flex items-start gap-3">
            {/* Checkbox */}
            <div className="flex items-center mt-1">
              <Checkbox
                checked={isConversationSelected?.(conversation.id) || false}
                onCheckedChange={(checked) =>
                  handleCheckboxChange(conversation.id, checked)
                }
                aria-label={tDialogs('selectConversation')}
              />
            </div>

            {/* Conversation Details */}
            <div className="flex-1 min-w-0">
              {/* Header with title and timestamp */}
              <div className="flex items-start justify-between mb-1.5">
                <h3 className="text-sm font-medium text-foreground truncate flex-1 tracking-tight">
                  {conversation?.title || conversation.customer.name}
                </h3>
                <span className="text-xs text-muted-foreground ml-4 flex-shrink-0 tracking-tight font-medium">
                  {formatDateSmart(conversation.last_message_at || '')}
                </span>
              </div>

              {/* Last message preview with unread message count */}
              <div className="flex items-center justify-between mb-3 gap-2">
                <p className="text-sm text-muted-foreground truncate flex-1 tracking-tight">
                  {getLastMessagePreview(conversation)}
                </p>
                {conversation.unread_count > 0 && (
                  <div className="bg-blue-600 text-primary-foreground text-xs h-5 min-w-5 rounded-full px-1 py-2 leading-none flex items-center justify-center flex-shrink-0">
                    {conversation.unread_count}
                  </div>
                )}
              </div>

              {/* Badges */}
              <div className="flex items-center space-x-2">
                {/* Priority badge */}
                {conversation.priority &&
                  conversation.status === 'open' &&
                  conversation.priority !== 'medium' &&
                  conversation.priority in priorityConfig && (
                    <Badge
                      dot
                      className="min-w-fit"
                      variant={
                        priorityConfig[
                          conversation.priority as keyof typeof priorityConfig
                        ].variant
                      }
                    >
                      {t(
                        priorityConfig[
                          conversation.priority as keyof typeof priorityConfig
                        ].translationKey
                      )}
                    </Badge>
                  )}

                {/* Type badge */}
                {conversation.type && conversation.type in categoryConfig && (
                  <Badge
                    variant="outline"
                    icon={
                      categoryConfig[
                        conversation.type as keyof typeof categoryConfig
                      ].icon
                    }
                  >
                    {t(
                      categoryConfig[
                        conversation.type as keyof typeof categoryConfig
                      ].translationKey
                    )}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
