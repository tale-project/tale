'use client';

import type { UIMessage } from '@convex-dev/agent/react';

import { Loader2, CheckCircle2 } from 'lucide-react';
import { type RefObject } from 'react';

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
  aiResponseAreaRef: RefObject<HTMLDivElement | null>;
  activeApproval: ChatItem | null;
  onHumanInputResponseSubmitted?: () => void;
  onSendFollowUp?: (message: string) => void;
}

/**
 * Renders the chat message list with a single active approval at the bottom.
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
  aiResponseAreaRef,
  activeApproval,
  onHumanInputResponseSubmitted,
  onSendFollowUp,
}: ChatMessagesProps) {
  const { t } = useT('chat');

  return (
    <div
      className="mx-auto max-w-(--chat-max-width) space-y-4 pt-10"
      role="log"
      aria-live="polite"
      aria-label={t('aria.messageHistory')}
    >
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

        return shouldShow ? (
          <MessageBubble
            key={message.key}
            message={{
              ...message,
              role: message.role === 'user' ? 'user' : 'assistant',
              threadId: threadId,
            }}
            onSendFollowUp={onSendFollowUp}
          />
        ) : null;
      })}

      <div ref={aiResponseAreaRef}>
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
    </div>
  );
}
