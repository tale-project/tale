'use client';

import type { UIMessage } from '@convex-dev/agent/react';

import { Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { ChatItem } from '@/app/features/chat/hooks/use-merged-chat-items';

import { Text } from '@/app/components/ui/typography/text';
import { ApprovalCardRenderer } from '@/app/features/chat/components/approval-card-renderer';
import {
  FileAttachmentDisplay,
  FilePartDisplay,
} from '@/app/features/chat/components/message-bubble/file-displays';
import { ThinkingAnimation } from '@/app/features/chat/components/thinking-animation';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { AssistantMessageInfo } from './assistant-message-info';

interface TestMessageListProps {
  displayItems: ChatItem[];
  activeApproval: ChatItem | null;
  isLoading: boolean;
  activeMessage?: UIMessage;
  organizationId: string;
}

export function TestMessageList({
  displayItems,
  activeApproval,
  isLoading,
  activeMessage,
  organizationId,
}: TestMessageListProps) {
  const { t } = useT('settings');

  if (displayItems.length === 0) {
    return (
      <div className="flex h-full flex-col items-start justify-start py-4">
        <div className="flex items-start gap-2">
          <div className="bg-muted h-fit shrink-0 rounded-lg p-1.5">
            <Bot className="text-muted-foreground size-3.5" />
          </div>
          <div className="bg-muted text-foreground max-w-[85%] rounded-lg px-3 py-2">
            <Text variant="body-sm">{t('customAgents.testChat.welcome')}</Text>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label={t('customAgents.testChat.messageHistory')}
    >
      {displayItems.map((item) => {
        if (item.type !== 'message') return null;

        const message = item.data;
        return (
          <div
            key={message.key}
            className={cn(
              'flex gap-1',
              message.role === 'user' ? 'justify-end' : 'justify-start',
            )}
          >
            <div
              className={cn(
                'rounded-2xl px-4 py-3',
                message.role === 'user'
                  ? 'bg-muted text-foreground max-w-xs lg:max-w-md'
                  : 'text-foreground bg-background',
              )}
            >
              {message.fileParts && message.fileParts.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {message.fileParts.map((part) => (
                    <FilePartDisplay key={part.url} filePart={part} />
                  ))}
                </div>
              )}
              {message.content && (
                <div className="text-sm leading-5">
                  {message.role === 'assistant' ? (
                    <div className="prose prose-sm dark:prose-invert prose-p:my-0.5 prose-pre:my-1 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:p-2 prose-pre:overflow-x-auto prose-headings:my-1 max-w-none wrap-break-word">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <Text
                      variant="body-sm"
                      className="leading-relaxed wrap-break-word whitespace-pre-wrap"
                    >
                      {message.content}
                    </Text>
                  )}
                </div>
              )}
              {message.attachments && message.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {message.attachments.map((attachment) => (
                    <FileAttachmentDisplay
                      key={attachment.fileId}
                      attachment={attachment}
                    />
                  ))}
                </div>
              )}
              {message.role === 'assistant' &&
                !message.id.startsWith('pending-') &&
                message.content && (
                  <AssistantMessageInfo
                    messageId={message.id}
                    timestamp={message.timestamp}
                    content={message.content}
                  />
                )}
            </div>
          </div>
        );
      })}
      {isLoading && <ThinkingAnimation streamingMessage={activeMessage} />}

      {/* Single active approval always at the bottom */}
      {activeApproval && (
        <ApprovalCardRenderer
          item={activeApproval}
          organizationId={organizationId}
        />
      )}
    </div>
  );
}
