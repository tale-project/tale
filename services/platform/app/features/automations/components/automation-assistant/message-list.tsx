'use client';

import { AnimatePresence } from 'framer-motion';
import { Bot, CheckCircle2, LoaderCircle } from 'lucide-react';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type {
  DocumentWriteApproval,
  HumanInputRequest,
  IntegrationApproval,
  WorkflowCreationApproval,
  WorkflowRunApproval,
  WorkflowUpdateApproval,
} from '@/app/features/chat/hooks/queries';
import type { ChatItem } from '@/app/features/chat/hooks/use-merged-chat-items';

import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Image } from '@/app/components/ui/data-display/image';
import { Text } from '@/app/components/ui/typography/text';
import { ApprovalCardRenderer } from '@/app/features/chat/components/approval-card-renderer';
import { CollapsibleSystemMessage } from '@/app/features/chat/components/collapsible-system-message';
import { FileAttachmentDisplay } from '@/app/features/chat/components/message-bubble/file-displays';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { Message } from './types';

import { AutomationDetailsCollapse } from './automation-details-collapse';
import { ThinkingAnimation } from './thinking-animation';

interface MessageListProps {
  displayMessages: Message[];
  isLoading: boolean;
  isWaitingForResponse: boolean;
  workflow: { status?: string } | null | undefined;
  organizationId: string;
  workflowUpdateApprovals: WorkflowUpdateApproval[];
  workflowCreationApprovals: WorkflowCreationApproval[];
  workflowRunApprovals: WorkflowRunApproval[];
  humanInputRequests: HumanInputRequest[];
  documentWriteApprovals: DocumentWriteApproval[];
  integrationApprovals: IntegrationApproval[];
  onImagePreview: (src: string, alt: string) => void;
}

function isActiveStatus(status: string) {
  return status === 'pending' || status === 'executing';
}

export function MessageList({
  displayMessages,
  isLoading,
  isWaitingForResponse,
  workflow,
  organizationId,
  workflowUpdateApprovals,
  workflowCreationApprovals,
  workflowRunApprovals,
  humanInputRequests,
  documentWriteApprovals,
  integrationApprovals,
  onImagePreview,
}: MessageListProps) {
  const { t } = useT('automations');

  // Find the latest active (pending/executing) approval across all types
  const activeApproval = useMemo((): ChatItem | null => {
    const candidates: Exclude<ChatItem, { type: 'message' }>[] = [];

    for (const a of integrationApprovals) {
      if (isActiveStatus(a.status)) {
        candidates.push({ type: 'approval', data: a });
      }
    }
    for (const a of workflowCreationApprovals) {
      if (isActiveStatus(a.status)) {
        candidates.push({ type: 'workflow_approval', data: a });
      }
    }
    for (const a of workflowUpdateApprovals) {
      if (isActiveStatus(a.status)) {
        candidates.push({ type: 'workflow_update_approval', data: a });
      }
    }
    for (const a of workflowRunApprovals) {
      if (isActiveStatus(a.status)) {
        candidates.push({ type: 'workflow_run_approval', data: a });
      }
    }
    for (const a of humanInputRequests) {
      if (isActiveStatus(a.status)) {
        candidates.push({ type: 'human_input_request', data: a });
      }
    }
    for (const a of documentWriteApprovals) {
      if (isActiveStatus(a.status)) {
        candidates.push({ type: 'document_write_approval', data: a });
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.data._creationTime - a.data._creationTime);
    return candidates[0];
  }, [
    integrationApprovals,
    workflowCreationApprovals,
    workflowUpdateApprovals,
    workflowRunApprovals,
    humanInputRequests,
    documentWriteApprovals,
  ]);

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
                <Text variant="caption">{t('assistant.loading')}</Text>
              </div>
            ) : workflow === null ? (
              <Text variant="caption">{t('assistant.notFound')}</Text>
            ) : (
              <Text variant="body-sm">
                {workflow.status === 'draft'
                  ? t('assistant.welcomeDraft')
                  : t('assistant.welcomeActive')}
              </Text>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label={t('assistant.messageHistory')}
    >
      {displayMessages.map((message) => {
        // Human input response: green pill aligned right
        if (message.isHumanInputResponse && message.role === 'system') {
          const match = message.content.match(
            /^User responded to question "(.*?)": ([\s\S]+)$/,
          );
          const response = match?.[2] ?? message.content;

          return (
            <div key={message.id} className="flex justify-end py-1">
              <div className="bg-primary/10 text-primary flex items-center gap-2 rounded-full px-4 py-2 text-sm">
                <CheckCircle2 className="size-4" />
                <span>{response}</span>
              </div>
            </div>
          );
        }

        // Non-human-input system messages: collapsible info block
        if (message.role === 'system') {
          return (
            <CollapsibleSystemMessage
              key={message.id}
              content={message.content}
            />
          );
        }

        return (
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
              <div
                className={cn(
                  'rounded-2xl px-4 py-3',
                  message.role === 'user'
                    ? 'bg-muted text-foreground'
                    : 'bg-background text-foreground',
                )}
              >
                {message.fileParts && message.fileParts.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {message.fileParts.map((part, partIndex) =>
                      part.mediaType.startsWith('image/') ? (
                        <button
                          key={partIndex}
                          type="button"
                          aria-label={t('assistant.previewImage', {
                            filename:
                              part.filename || t('assistant.fallbackImage'),
                          })}
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
                            <Text as="div" variant="label" truncate>
                              {part.filename || t('assistant.fallbackFile')}
                            </Text>
                          </div>
                        </a>
                      ),
                    )}
                  </div>
                )}
                {message.attachments && message.attachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {message.attachments.map((attachment) => (
                      <FileAttachmentDisplay
                        key={attachment.fileId}
                        attachment={attachment}
                      />
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
              </div>
            </div>
          </div>
        );
      })}
      <AnimatePresence>
        {(isLoading || isWaitingForResponse) && (
          <ThinkingAnimation
            steps={[
              t('assistant.thinking.thinking'),
              t('assistant.thinking.analyzing'),
              t('assistant.thinking.compiling'),
            ]}
          />
        )}
      </AnimatePresence>

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
