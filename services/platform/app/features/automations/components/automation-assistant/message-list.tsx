'use client';

import { Bot, LoaderCircle } from 'lucide-react';

import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Image } from '@/app/components/ui/data-display/image';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { Message } from './types';

import { AutomationDetailsCollapse } from './automation-details-collapse';
import { CollapsibleMessage } from './collapsible-message';
import { ThinkingAnimation } from './thinking-animation';

interface MessageListProps {
  displayMessages: Message[];
  isLoading: boolean;
  isWaitingForResponse: boolean;
  workflow: { status?: string } | null | undefined;
  onImagePreview: (src: string, alt: string) => void;
}

export function MessageList({
  displayMessages,
  isLoading,
  isWaitingForResponse,
  workflow,
  onImagePreview,
}: MessageListProps) {
  const { t } = useT('automations');

  if (displayMessages.length === 0) {
    return (
      <div className="flex h-full flex-col items-start justify-start py-4">
        <div className="flex items-start gap-2">
          <div className="bg-muted h-fit shrink-0 rounded-lg p-1.5">
            <Bot className="text-muted-foreground size-3.5" />
          </div>
          <div className="bg-muted text-foreground max-w-[85%] rounded-lg px-3 py-2">
            {workflow === undefined ? (
              <div className="flex items-center gap-2">
                <LoaderCircle className="text-muted-foreground size-3 animate-spin" />
                <p className="text-muted-foreground text-xs">
                  {t('assistant.loading')}
                </p>
              </div>
            ) : workflow === null ? (
              <p className="text-muted-foreground text-xs">
                {t('assistant.notFound')}
              </p>
            ) : (
              <p className="text-xs">
                {workflow.status === 'draft'
                  ? t('assistant.welcomeDraft')
                  : t('assistant.welcomeActive')}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {displayMessages.map((message, index) => (
        <div
          key={message.id}
          className={cn(
            'flex gap-1',
            message.role === 'user' ? 'justify-end' : 'justify-start',
          )}
        >
          <div className="flex max-w-[92.5%] flex-col gap-2">
            {message.automationContext && (
              <AutomationDetailsCollapse
                context={message.automationContext}
                title={t('assistant.automationDetails')}
              />
            )}
            {message.fileParts && message.fileParts.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {message.fileParts.map((part, partIndex) =>
                  part.mediaType.startsWith('image/') ? (
                    <button
                      key={partIndex}
                      type="button"
                      onClick={() =>
                        onImagePreview(
                          part.url,
                          part.filename || t('assistant.fallbackImage'),
                        )
                      }
                      className="bg-muted focus:ring-ring size-11 cursor-pointer overflow-hidden rounded-lg bg-cover bg-center bg-no-repeat transition-opacity hover:opacity-90 focus:ring-2 focus:ring-offset-2 focus:outline-none"
                    >
                      <Image
                        src={part.url}
                        alt={part.filename || t('assistant.fallbackImage')}
                        className="size-full object-cover"
                        width={44}
                        height={44}
                      />
                    </button>
                  ) : (
                    <a
                      key={partIndex}
                      href={part.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-muted hover:bg-muted/80 flex max-w-[13.5rem] items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
                    >
                      <DocumentIcon fileName={part.filename || 'file'} />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="text-foreground truncate text-sm font-medium">
                          {part.filename || t('assistant.fallbackFile')}
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
                  'rounded-lg px-2.5 py-2',
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground',
                )}
              >
                <CollapsibleMessage
                  content={message.content}
                  role={message.role}
                  isMarkdown={message.role === 'assistant'}
                  viewMoreLabel={t('assistant.viewMore')}
                  viewLessLabel={t('assistant.viewLess')}
                  isLastMessage={index === displayMessages.length - 1}
                />
              </div>
            )}
          </div>
        </div>
      ))}
      {(isLoading || isWaitingForResponse) && (
        <ThinkingAnimation
          steps={[
            t('assistant.thinking.thinking'),
            t('assistant.thinking.analyzing'),
            t('assistant.thinking.compiling'),
          ]}
        />
      )}
    </>
  );
}
