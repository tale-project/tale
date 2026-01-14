'use client';

import { Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { Button } from '@/components/ui/primitives/button';
import { MessageBubble } from './message-bubble';
import { IntegrationApprovalCard } from './integration-approval-card';
import { WorkflowCreationApprovalCard } from './workflow-creation-approval-card';
import { ThinkingAnimation } from './thinking-animation';
import type { ChatItem } from '../hooks/use-merged-chat-items';
import type { UIMessage } from '@convex-dev/agent/react';
import type { RefObject } from 'react';

interface ChatMessagesProps {
  items: ChatItem[];
  threadId: string | undefined;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  loadMore: (numItems: number) => void;
  isPending: boolean;
  streamingMessage: UIMessage | undefined;
  hasActiveTools: boolean;
  aiResponseAreaRef: RefObject<HTMLDivElement | null>;
}

/**
 * Renders the chat message list with approvals and thinking animation.
 */
export function ChatMessages({
  items,
  threadId,
  canLoadMore,
  isLoadingMore,
  loadMore,
  isPending,
  streamingMessage,
  hasActiveTools,
  aiResponseAreaRef,
}: ChatMessagesProps) {
  const { t } = useT('chat');

  return (
    <div
      className="max-w-[var(--chat-max-width)] mx-auto space-y-4"
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

      {/* Render merged messages and approvals */}
      {items.map((item) => {
        if (item.type === 'message') {
          const message = item.data;
          const shouldShow =
            message.role === 'user' || message.content !== '';

          return shouldShow ? (
            <MessageBubble
              key={message.key}
              message={{
                ...message,
                threadId: threadId,
              }}
            />
          ) : null;
        } else if (item.type === 'approval') {
          const approval = item.data;
          return (
            <div key={`approval-${approval._id}`} className="flex justify-start">
              <IntegrationApprovalCard
                approvalId={approval._id}
                status={approval.status}
                metadata={approval.metadata}
                executedAt={approval.executedAt}
                executionError={approval.executionError}
              />
            </div>
          );
        } else {
          const approval = item.data;
          return (
            <div
              key={`workflow-approval-${approval._id}`}
              className="flex justify-start"
            >
              <WorkflowCreationApprovalCard
                approvalId={approval._id}
                status={approval.status}
                metadata={approval.metadata}
                executedAt={approval.executedAt}
                executionError={approval.executionError}
              />
            </div>
          );
        }
      })}

      {/* Thinking animation area */}
      <div ref={aiResponseAreaRef}>
        {((isPending && !streamingMessage) ||
          (streamingMessage?.status === 'streaming' && !streamingMessage.text) ||
          hasActiveTools) && (
          <ThinkingAnimation streamingMessage={streamingMessage} />
        )}
      </div>
    </div>
  );
}
