'use client';

import type { UIMessage } from '@convex-dev/agent/react';
import type { RefObject } from 'react';

import { Loader2, CheckCircle2 } from 'lucide-react';

import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

import type { ChatItem } from '../hooks/use-merged-chat-items';

import { HumanInputRequestCard } from './human-input-request-card';
import { IntegrationApprovalCard } from './integration-approval-card';
import { MessageBubble } from './message-bubble';
import { ThinkingAnimation } from './thinking-animation';
import { WorkflowCreationApprovalCard } from './workflow-creation-approval-card';

interface ChatMessagesProps {
  items: ChatItem[];
  threadId: string | undefined;
  organizationId: string;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  loadMore: (numItems: number) => void;
  isPending: boolean;
  streamingMessage: UIMessage | undefined;
  pendingToolResponse: UIMessage | undefined;
  hasActiveTools: boolean;
  isProcessingToolResult: boolean;
  aiResponseAreaRef: RefObject<HTMLDivElement | null>;
  onHumanInputResponseSubmitted?: () => void;
  onSendFollowUp?: (message: string) => void;
}

/**
 * Renders the chat message list with approvals and thinking animation.
 */
export function ChatMessages({
  items,
  threadId,
  organizationId,
  canLoadMore,
  isLoadingMore,
  loadMore,
  isPending,
  streamingMessage,
  pendingToolResponse,
  hasActiveTools,
  isProcessingToolResult,
  aiResponseAreaRef,
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

      {/* Render merged messages and approvals */}
      {items.map((item) => {
        if (item.type === 'message') {
          const message = item.data;

          // Render human input response as a special system message
          if (message.isHumanInputResponse && message.role === 'system') {
            // Parse the response from the message content
            // Format: "User responded to question \"<question>\": <response>"
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

          const shouldShow = message.role === 'user' || message.content !== '';

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
        } else if (item.type === 'approval') {
          const approval = item.data;
          return (
            <div
              key={`approval-${approval._id}`}
              className="flex justify-start"
            >
              <IntegrationApprovalCard
                approvalId={approval._id}
                organizationId={organizationId}
                status={approval.status}
                metadata={approval.metadata}
                executedAt={approval.executedAt}
                executionError={approval.executionError}
              />
            </div>
          );
        } else if (item.type === 'workflow_approval') {
          const approval = item.data;
          return (
            <div
              key={`workflow-approval-${approval._id}`}
              className="flex justify-start"
            >
              <WorkflowCreationApprovalCard
                approvalId={approval._id}
                organizationId={organizationId}
                status={approval.status}
                metadata={approval.metadata}
                executedAt={approval.executedAt}
                executionError={approval.executionError}
              />
            </div>
          );
        } else if (item.type === 'human_input_request') {
          const request = item.data;
          return (
            <div
              key={`human-input-${request._id}`}
              className="flex justify-start"
            >
              <HumanInputRequestCard
                approvalId={request._id}
                status={request.status}
                metadata={request.metadata}
                onResponseSubmitted={onHumanInputResponseSubmitted}
              />
            </div>
          );
        }
        return null;
      })}

      {/* Thinking animation area */}
      <div ref={aiResponseAreaRef}>
        {((isPending && !streamingMessage) ||
          (streamingMessage?.status === 'streaming' &&
            !streamingMessage.text) ||
          hasActiveTools ||
          isProcessingToolResult ||
          !!pendingToolResponse) && (
          <ThinkingAnimation streamingMessage={streamingMessage} />
        )}
      </div>
    </div>
  );
}
