'use client';

import type { UIMessage } from '@convex-dev/agent/react';

import { Loader2, CheckCircle2, Info, ChevronDown } from 'lucide-react';
import { memo, type RefObject, useCallback, useState } from 'react';

import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { ChatItem } from '../hooks/use-merged-chat-items';

import { ApprovalCardRenderer } from './approval-card-renderer';
import { MessageBubble } from './message-bubble';
import { ThinkingAnimation } from './thinking-animation';

const CollapsibleSystemMessage = memo(function CollapsibleSystemMessage({
  content,
}: {
  content: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const formatted = content.replace(
    /\[([A-Z][A-Z_]+)\]/g,
    (_, tag: string) => `${tag.replaceAll('_', ' ')} -`,
  );
  const lines = formatted.split('\n');
  const nonEmptyLines = lines.filter((l) => l.trim() !== '');
  const previewLines = nonEmptyLines.slice(0, 2);
  const preview = previewLines.join(' ');
  const lastPreviewIdx =
    previewLines.length > 0
      ? lines.indexOf(previewLines[previewLines.length - 1])
      : 0;
  const rest = lines
    .slice(lastPreviewIdx + 1)
    .join('\n')
    .trimStart();
  const hasMore = rest.length > 0;

  return (
    <div className="py-1" role="status">
      <div className="bg-muted/50 text-muted-foreground overflow-hidden rounded-lg text-xs">
        <button
          type="button"
          className="flex w-full items-start gap-2 px-3 py-1.5"
          onClick={toggle}
          disabled={!hasMore}
          aria-expanded={expanded}
        >
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 text-left">{preview}</span>
          {hasMore && (
            <ChevronDown
              className={cn(
                'mt-0.5 ml-auto size-3.5 shrink-0 transition-transform',
                expanded && 'rotate-180',
              )}
            />
          )}
        </button>
        {expanded && (
          <div className="border-muted max-h-60 overflow-y-auto border-t px-3 py-2 whitespace-pre-wrap">
            {rest}
          </div>
        )}
      </div>
    </div>
  );
});

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
