'use client';

import { Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { ChatItem } from '@/app/features/chat/hooks/use-merged-chat-items';

import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Image } from '@/app/components/ui/data-display/image';
import { HumanInputRequestCard } from '@/app/features/chat/components/human-input-request-card';
import { IntegrationApprovalCard } from '@/app/features/chat/components/integration-approval-card';
import { WorkflowCreationApprovalCard } from '@/app/features/chat/components/workflow-creation-approval-card';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { AssistantMessageInfo } from './assistant-message-info';
import { ThinkingDots } from './thinking-dots';

interface TestMessageListProps {
  displayItems: ChatItem[];
  isBusy: boolean;
  organizationId: string;
  onImagePreview: (src: string, alt: string) => void;
}

export function TestMessageList({
  displayItems,
  isBusy,
  organizationId,
  onImagePreview,
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
            <p className="text-xs">{t('customAgents.testChat.welcome')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {displayItems.map((item) => {
        if (item.type === 'approval') {
          return (
            <div
              key={`approval-${item.data._id}`}
              className="flex justify-start"
            >
              <IntegrationApprovalCard
                approvalId={item.data._id}
                organizationId={organizationId}
                status={item.data.status}
                metadata={item.data.metadata}
                executedAt={item.data.executedAt}
                executionError={item.data.executionError}
              />
            </div>
          );
        }

        if (item.type === 'workflow_approval') {
          return (
            <div
              key={`workflow-approval-${item.data._id}`}
              className="flex justify-start"
            >
              <WorkflowCreationApprovalCard
                approvalId={item.data._id}
                organizationId={organizationId}
                status={item.data.status}
                metadata={item.data.metadata}
                executedAt={item.data.executedAt}
                executionError={item.data.executionError}
              />
            </div>
          );
        }

        if (item.type === 'human_input_request') {
          return (
            <div
              key={`human-input-${item.data._id}`}
              className="flex justify-start"
            >
              <HumanInputRequestCard
                approvalId={item.data._id}
                status={item.data.status}
                metadata={item.data.metadata}
              />
            </div>
          );
        }

        const message = item.data;
        return (
          <div
            key={message.key}
            className={cn(
              'flex gap-1',
              message.role === 'user' ? 'justify-end' : 'justify-start',
            )}
          >
            <div className="flex max-w-[92.5%] min-w-0 flex-col gap-2">
              {message.fileParts && message.fileParts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {message.fileParts.map((part, idx) =>
                    part.mediaType.startsWith('image/') ? (
                      <button
                        key={idx}
                        type="button"
                        onClick={() =>
                          onImagePreview(part.url, part.filename || 'Image')
                        }
                        className="bg-muted focus:ring-ring size-11 cursor-pointer overflow-hidden rounded-lg bg-cover bg-center bg-no-repeat transition-opacity hover:opacity-90 focus:ring-2 focus:ring-offset-2 focus:outline-none"
                      >
                        <Image
                          src={part.url}
                          alt={part.filename || 'Image'}
                          className="size-full object-cover"
                          width={44}
                          height={44}
                        />
                      </button>
                    ) : (
                      <a
                        key={idx}
                        href={part.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-muted hover:bg-muted/80 flex max-w-[13.5rem] items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
                      >
                        <DocumentIcon fileName={part.filename || 'file'} />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="text-foreground truncate text-sm font-medium">
                            {part.filename || 'File'}
                          </div>
                        </div>
                      </a>
                    ),
                  )}
                </div>
              )}
              {message.content && (
                <div
                  className={cn(
                    'overflow-hidden rounded-lg px-2.5 py-2',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground',
                  )}
                >
                  {message.role === 'assistant' ? (
                    <div className="max-w-none text-xs break-words">
                      <Bot className="text-muted-foreground mb-1.5 size-3.5" />
                      <div className="prose prose-sm dark:prose-invert prose-p:my-0.5 prose-pre:my-1 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:p-2 prose-pre:overflow-x-auto prose-pre:text-[10px] prose-headings:my-1 prose-headings:text-xs max-w-none text-xs break-words">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs leading-relaxed break-words whitespace-pre-wrap">
                      {message.content}
                    </p>
                  )}
                </div>
              )}
              {message.role === 'assistant' &&
                !message.id.startsWith('pending-') &&
                message.content && (
                  <AssistantMessageInfo
                    messageId={message.id}
                    timestamp={message.timestamp}
                  />
                )}
            </div>
          </div>
        );
      })}
      {isBusy && <ThinkingDots />}
    </>
  );
}
