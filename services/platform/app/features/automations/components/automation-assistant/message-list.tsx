'use client';

import { AnimatePresence } from 'framer-motion';
import { Bot, LoaderCircle } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type {
  WorkflowCreationApproval,
  WorkflowUpdateApproval,
} from '@/app/features/chat/hooks/queries';

import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Image } from '@/app/components/ui/data-display/image';
import { Text } from '@/app/components/ui/typography/text';
import { WorkflowCreationApprovalCard } from '@/app/features/chat/components/workflow-creation-approval-card';
import { WorkflowUpdateApprovalCard } from '@/app/features/chat/components/workflow-update-approval-card';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { Message } from './types';

import { AutomationDetailsCollapse } from './automation-details-collapse';
import { ThinkingAnimation } from './thinking-animation';

type ApprovalItem =
  | { type: 'workflow_update'; data: WorkflowUpdateApproval }
  | { type: 'workflow_creation'; data: WorkflowCreationApproval };

interface MessageListProps {
  displayMessages: Message[];
  isLoading: boolean;
  isWaitingForResponse: boolean;
  workflow: { status?: string } | null | undefined;
  organizationId: string;
  workflowUpdateApprovals: WorkflowUpdateApproval[];
  workflowCreationApprovals: WorkflowCreationApproval[];
  onImagePreview: (src: string, alt: string) => void;
}

export function MessageList({
  displayMessages,
  isLoading,
  isWaitingForResponse,
  workflow,
  organizationId,
  workflowUpdateApprovals,
  workflowCreationApprovals,
  onImagePreview,
}: MessageListProps) {
  const { t } = useT('automations');

  const messageIds = useMemo(
    () => new Set(displayMessages.map((m) => m.id)),
    [displayMessages],
  );

  const approvalsByMessageId = useMemo(() => {
    const byMessageId = new Map<string, ApprovalItem[]>();

    const allApprovals: ApprovalItem[] = [
      ...workflowUpdateApprovals.map(
        (a): ApprovalItem => ({ type: 'workflow_update', data: a }),
      ),
      ...workflowCreationApprovals.map(
        (a): ApprovalItem => ({ type: 'workflow_creation', data: a }),
      ),
    ];

    for (const item of allApprovals) {
      const mid = item.data.messageId;
      if (mid && messageIds.has(mid)) {
        const list = byMessageId.get(mid) ?? [];
        list.push(item);
        byMessageId.set(mid, list);
      }
    }

    return byMessageId;
  }, [workflowUpdateApprovals, workflowCreationApprovals, messageIds]);

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
    <>
      {displayMessages.map((message) => (
        <Fragment key={message.id}>
          <div
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
          {approvalsByMessageId.get(message.id)?.map((item) => (
            <div
              key={`approval-${item.data._id}`}
              className="flex justify-start"
            >
              {item.type === 'workflow_update' ? (
                <WorkflowUpdateApprovalCard
                  approvalId={item.data._id}
                  organizationId={organizationId}
                  status={item.data.status}
                  metadata={item.data.metadata}
                  executedAt={item.data.executedAt}
                  executionError={item.data.executionError}
                  className="max-w-full"
                />
              ) : (
                <WorkflowCreationApprovalCard
                  approvalId={item.data._id}
                  organizationId={organizationId}
                  status={item.data.status}
                  metadata={item.data.metadata}
                  executedAt={item.data.executedAt}
                  executionError={item.data.executionError}
                  className="max-w-full"
                />
              )}
            </div>
          ))}
        </Fragment>
      ))}
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
    </>
  );
}
