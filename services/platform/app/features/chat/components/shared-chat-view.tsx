'use client';

import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { GitFork, ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useId, useState } from 'react';

import { PanelFooter } from '@/app/components/layout/panel-footer';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useForkAndChat, useForkThread } from '../hooks/mutations';
import { useChatAgents } from '../hooks/queries';
import { useConvexFileUpload } from '../hooks/use-convex-file-upload';
import type { FileAttachment } from '../types';
import { ChatInput } from './chat-input';
import { MessageBubble } from './message-bubble';

interface SharedChatViewProps {
  organizationId: string;
  shareToken: string;
}

// Placeholder message rows for the query-load window (no real shared-thread
// messages have arrived yet). Mirror the real message column's user/assistant
// alternation so the swap into real bubbles doesn't shift the layout.
const PLACEHOLDER_SHARED_ROWS: Array<{
  align: 'start' | 'end';
  widths: string[];
}> = [
  { align: 'end', widths: ['w-40'] },
  { align: 'start', widths: ['w-full', 'w-5/6', 'w-2/3'] },
  { align: 'end', widths: ['w-56'] },
  { align: 'start', widths: ['w-full', 'w-4/5'] },
];

export function SharedChatView({
  organizationId,
  shareToken,
}: SharedChatViewProps) {
  const { t } = useT('chat');
  const messageHistoryLabelId = useId();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [inputValue, setInputValue] = useState('');

  const { data: sharedThread, isLoading } = useConvexQuery(
    api.threads.queries.getSharedThread,
    { shareToken },
  );

  const { mutate: forkThread, isPending: isForking } = useForkThread();
  const { mutateAsync: forkAndChat, isPending: isForkingAndChatting } =
    useForkAndChat();

  const { agents } = useChatAgents(organizationId);

  const {
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    clearAttachments,
  } = useConvexFileUpload({ organizationId });

  const isSending = isForkingAndChatting;

  const handleFork = useCallback(() => {
    forkThread(
      { shareToken },
      {
        onSuccess: (newThreadId) => {
          void navigate({
            to: '/dashboard/$id/chat/$threadId',
            params: { id: organizationId, threadId: newThreadId },
          });
          toast({ title: t('share.forkSuccess'), variant: 'success' });
        },
        onError: () => {
          toast({ title: t('share.forkFailed'), variant: 'destructive' });
        },
      },
    );
  }, [forkThread, shareToken, navigate, organizationId, toast, t]);

  const handleSendMessage = useCallback(
    async (message: string, _attachments?: FileAttachment[]) => {
      if (!message.trim() || isSending) return;

      const agentSlug =
        sharedThread?.agentSlug ??
        (agents && agents.length > 0 ? agents[0].name : null);

      if (!agentSlug) {
        toast({ title: t('toast.sendFailed'), variant: 'destructive' });
        return;
      }

      try {
        const result = await forkAndChat({
          shareToken,
          message,
          agentSlug,
          organizationId,
        });

        void navigate({
          to: '/dashboard/$id/chat/$threadId',
          params: { id: organizationId, threadId: result.threadId },
        });
      } catch {
        toast({ title: t('share.forkFailed'), variant: 'destructive' });
      }
    },
    [
      isSending,
      sharedThread?.agentSlug,
      agents,
      shareToken,
      organizationId,
      forkAndChat,
      navigate,
      toast,
      t,
    ],
  );

  const handleBack = useCallback(() => {
    void navigate({
      to: '/dashboard/$id/chat',
      params: { id: organizationId },
    });
  }, [navigate, organizationId]);

  // Resolved-but-missing (bad/expired token) is a real not-found state, not a
  // loading state — render it as real text, never masked.
  if (!isLoading && !sharedThread) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <Text variant="muted">{t('share.notFound')}</Text>
        <Button variant="secondary" onClick={handleBack}>
          <ArrowLeft className="mr-2 size-4" />
          {t('share.backToChat')}
        </Button>
      </div>
    );
  }

  // One real tree, always. While the shared-thread query resolves there are no
  // real messages, so placeholder rows stand in; each dynamic leaf (title,
  // fork button, message bubbles, composer) is masked at the point it renders
  // inside <Skeletonize loading>. Static labels/headings stay real text.
  return (
    <Skeletonize loading={isLoading}>
      <div className="flex h-full flex-col">
        <div className="border-border flex h-13 items-center justify-between border-b px-5">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              aria-label={t('share.backToChat')}
            >
              <ArrowLeft className="text-muted-foreground size-5" />
            </Button>
            <div>
              <Heading level={4}>
                <SkeletonBox>
                  {sharedThread?.title ?? t('history.untitled')}
                </SkeletonBox>
              </Heading>
              <Text variant="muted" className="text-xs">
                {t('share.sharedChat')}
              </Text>
            </div>
          </div>
          <SkeletonBox>
            <Button
              variant="secondary"
              onClick={handleFork}
              disabled={isForking}
              className="gap-2"
            >
              {isForking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <GitFork className="size-4" />
              )}
              {t('share.forkChat')}
            </Button>
          </SkeletonBox>
        </div>

        <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto scroll-smooth">
          <div className="flex flex-col overflow-y-visible p-4 sm:p-6">
            <div
              className="mx-auto flex w-full max-w-(--chat-max-width) flex-col gap-3 pt-6"
              role="log"
              aria-live="polite"
              aria-labelledby={messageHistoryLabelId}
            >
              <h2 id={messageHistoryLabelId} className="sr-only">
                {t('aria.messageHistory')}
              </h2>
              {sharedThread
                ? sharedThread.messages.map(
                    (message: {
                      _id: string;
                      role: 'user' | 'assistant';
                      content: string;
                      _creationTime: number;
                    }) => (
                      <MessageBubble
                        key={message._id}
                        message={{
                          id: message._id,
                          role: message.role,
                          content: message.content,
                          timestamp: new Date(message._creationTime),
                        }}
                        hideFeedback
                      />
                    ),
                  )
                : PLACEHOLDER_SHARED_ROWS.map((row, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex flex-col gap-2',
                        row.align === 'end' ? 'items-end' : 'items-start',
                      )}
                    >
                      {row.widths.map((w, j) => (
                        <SkeletonBox key={j} fullWidth>
                          <div className={cn('h-4', w)} />
                        </SkeletonBox>
                      ))}
                    </div>
                  ))}
            </div>
          </div>

          <PanelFooter className="mt-auto">
            <FileUpload.Root>
              <ChatInput
                className="mx-auto w-full max-w-(--chat-max-width)"
                placeholder={t('share.inputPlaceholder')}
                value={inputValue}
                onChange={setInputValue}
                onSendMessage={handleSendMessage}
                isLoading={isSending}
                disabled={false}
                organizationId={organizationId}
                attachments={attachments}
                uploadingFiles={uploadingFiles}
                uploadFiles={uploadFiles}
                removeAttachment={removeAttachment}
                clearAttachments={clearAttachments}
              />
            </FileUpload.Root>
            <Text variant="muted" className="mt-1 text-center text-xs">
              {t('share.inputHint')}
            </Text>
          </PanelFooter>
        </div>
      </div>
    </Skeletonize>
  );
}
