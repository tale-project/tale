'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  CheckCircle2,
  GitBranchPlus,
  ListChecks,
  ListPlus,
  Lock,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useId, useState } from 'react';

import { PanelFooter } from '@/app/components/layout/panel-footer';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { ChatInput } from '../../chat/components/chat-input';
import { MessageBubble } from '../../chat/components/message-bubble';
import { useConvexFileUpload } from '../../chat/hooks/use-convex-file-upload';
import {
  useMessageProcessing,
  type ChatMessage,
} from '../../chat/hooks/use-message-processing';
import type { FileAttachment } from '../../chat/types';
import {
  useCreateTaskFromDiscussion,
  usePostReply,
  useSetDiscussionStatus,
} from '../hooks/mutations';
import { useDiscussion } from '../hooks/queries';
import {
  discussionCategoryLabel,
  DISCUSSION_STATUS_BADGE,
  type DiscussionStatus,
  toDiscussionStatus,
} from '../lib';

interface DiscussionThreadViewProps {
  organizationId: string;
  projectId: Id<'projects'>;
  threadId: string;
  onBack: () => void;
}

export function DiscussionThreadView({
  organizationId,
  projectId,
  threadId,
  onBack,
}: DiscussionThreadViewProps) {
  const { t } = useT('discussions');
  const navigate = useNavigate();
  const messageHistoryLabelId = useId();
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);

  const { data: discussion } = useDiscussion(organizationId, threadId);
  // Reuse the same streaming reader + processing pipeline chat uses, so agent
  // replies stream in live and render with full markdown. `messages` is already
  // the ChatMessage shape MessageBubble consumes.
  const { messages: allMessages } = useMessageProcessing(threadId);
  // MessageBubble renders user/assistant bubbles; drop system notices.
  const messages = allMessages.filter(
    (m): m is ChatMessage & { role: 'user' | 'assistant' } =>
      m.role === 'user' || m.role === 'assistant',
  );

  const {
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    clearAttachments,
  } = useConvexFileUpload({ organizationId });

  const { mutateAsync: postReply } = usePostReply();
  const { mutateAsync: setStatus } = useSetDiscussionStatus();
  const { mutateAsync: createTask } = useCreateTaskFromDiscussion();

  const status = toDiscussionStatus(discussion?.discussionStatus);
  const isLocked = status === 'locked';
  const category = discussion?.discussionCategory;
  // A discussion converts to a task exactly once (GitHub "convert to issue").
  // Once linked, the convert action becomes "View task" and an inline event
  // records the conversion in the thread.
  const linkedTaskId = discussion?.linkedTaskId ?? null;

  const handleSend = useCallback(
    async (message: string, _attachments?: FileAttachment[]) => {
      if (!message.trim() || isSending || isLocked) return;
      setIsSending(true);
      try {
        await postReply({ organizationId, threadId, message });
        setInputValue('');
      } catch (error) {
        console.error('Failed to post discussion reply', error);
        toast({ title: t('reply.failed'), variant: 'destructive' });
      } finally {
        setIsSending(false);
      }
    },
    [isSending, isLocked, postReply, organizationId, threadId, t],
  );

  const handleSetStatus = useCallback(
    async (next: DiscussionStatus) => {
      try {
        await setStatus({ organizationId, threadId, status: next });
      } catch (error) {
        console.error('Failed to set discussion status', error);
        toast({ title: t('status.failed'), variant: 'destructive' });
      }
    },
    [setStatus, organizationId, threadId, t],
  );

  const handleSpawnTask = useCallback(async () => {
    if (!discussion?.title || linkedTaskId) return;
    try {
      await createTask({
        organizationId,
        threadId,
        projectId,
        title: discussion.title,
      });
      toast({ title: t('spawnTask.success'), variant: 'success' });
    } catch (error) {
      console.error('Failed to create task from discussion', error);
      const alreadyConverted =
        typeof error === 'object' &&
        error !== null &&
        'data' in error &&
        typeof error.data === 'object' &&
        error.data !== null &&
        'code' in error.data &&
        error.data.code === 'already_converted';
      toast({
        title: alreadyConverted
          ? t('spawnTask.alreadyConverted')
          : t('spawnTask.failed'),
        variant: alreadyConverted ? 'default' : 'destructive',
      });
    }
  }, [
    createTask,
    organizationId,
    threadId,
    projectId,
    discussion?.title,
    linkedTaskId,
    t,
  ]);

  const goToTask = useCallback(() => {
    if (!linkedTaskId) return;
    void navigate({
      to: '/dashboard/$id/projects/$projectId/tasks/board',
      params: { id: organizationId, projectId: String(projectId) },
      search: { task: String(linkedTaskId) },
    });
  }, [navigate, linkedTaskId, organizationId, projectId]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex min-h-13 items-center justify-between gap-3 border-b px-5 py-2">
        <HStack gap={3} align="center" className="min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            title={t('backToList')}
          >
            <ArrowLeft className="text-muted-foreground size-5" />
          </Button>
          <div className="min-w-0">
            <HStack gap={2} align="center">
              <span className="truncate text-sm font-semibold">
                {discussion?.title ?? t('untitled')}
              </span>
              <Badge variant={DISCUSSION_STATUS_BADGE[status]}>
                {t(`status.${status}`)}
              </Badge>
            </HStack>
            {category ? (
              <Text variant="caption" className="text-muted-foreground text-xs">
                {discussionCategoryLabel(category, t)}
              </Text>
            ) : null}
          </div>
        </HStack>
        <HStack gap={2}>
          {linkedTaskId ? (
            <Button variant="secondary" size="sm" onClick={goToTask}>
              <ListChecks className="mr-1 size-4" />
              {t('spawnTask.viewTask')}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={handleSpawnTask}>
              <ListPlus className="mr-1 size-4" />
              {t('spawnTask.cta')}
            </Button>
          )}
          {status !== 'resolved' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleSetStatus('resolved')}
            >
              <CheckCircle2 className="mr-1 size-4" />
              {t('resolve')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleSetStatus('open')}
            >
              <RotateCcw className="mr-1 size-4" />
              {t('reopen')}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleSetStatus(isLocked ? 'open' : 'locked')}
          >
            <Lock className="mr-1 size-4" />
            {isLocked ? t('unlock') : t('lock')}
          </Button>
        </HStack>
      </div>

      <div className="flex h-full min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-smooth">
          <div className="flex flex-col overflow-y-visible p-4 sm:p-6">
            <div
              className="mx-auto flex w-full max-w-(--chat-max-width) flex-col gap-3 pt-2"
              role="log"
              aria-live="polite"
              aria-labelledby={messageHistoryLabelId}
            >
              <h2 id={messageHistoryLabelId} className="sr-only">
                {t('aria.transcript')}
              </h2>
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  hideFeedback
                />
              ))}
              {linkedTaskId ? (
                <div className="text-muted-foreground flex items-center justify-center gap-2 py-2 text-xs">
                  <GitBranchPlus className="size-3.5 shrink-0" aria-hidden />
                  <span>{t('spawnTask.converted')}</span>
                  <Link
                    to="/dashboard/$id/projects/$projectId/tasks/board"
                    params={{
                      id: organizationId,
                      projectId: String(projectId),
                    }}
                    search={{ task: String(linkedTaskId) }}
                    className="text-primary font-medium hover:underline"
                  >
                    {t('spawnTask.viewTask')}
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <PanelFooter>
          <FileUpload.Root>
            <ChatInput
              className="mx-auto w-full max-w-(--chat-max-width)"
              variant="assistant"
              placeholder={
                isLocked ? t('reply.lockedPlaceholder') : t('reply.placeholder')
              }
              value={inputValue}
              onChange={setInputValue}
              onSendMessage={handleSend}
              isLoading={isSending}
              disabled={isLocked}
              disabledReason={isLocked ? 'archived' : undefined}
              organizationId={organizationId}
              threadId={threadId}
              projectId={String(projectId)}
              attachments={attachments}
              uploadingFiles={uploadingFiles}
              uploadFiles={uploadFiles}
              removeAttachment={removeAttachment}
              clearAttachments={clearAttachments}
            />
          </FileUpload.Root>
          <Text variant="muted" className="mt-1 text-center text-xs">
            {t('reply.hint')}
          </Text>
        </PanelFooter>
      </div>
    </div>
  );
}
