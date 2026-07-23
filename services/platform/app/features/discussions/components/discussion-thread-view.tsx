'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  CheckCircle2,
  ListChecks,
  ListPlus,
  Lock,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { toastUnresolvedMentions } from '@/lib/shared/mention-unresolved';

import { AssigneeAvatar } from '../../tasks/components/assignee-avatar';
import { MentionText } from '../../tasks/components/mention-text';
import { MentionTextarea } from '../../tasks/components/mention-textarea';
import { MentionTriggerChips } from '../../tasks/components/mention-trigger-chips';
import { useActorDirectory } from '../../tasks/hooks/use-actor-directory';
import {
  useCreateTaskFromDiscussion,
  usePostReply,
  useSetDiscussionStatus,
} from '../hooks/mutations';
import { useDiscussion, useDiscussionMessages } from '../hooks/queries';
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

/**
 * A single discussion, opened from the project's discussions list: metadata
 * header (status, category, task backlink, resolve/lock controls), the
 * transcript, and the reply composer. Messages render as a flat comment list —
 * the same author-identity presentation task comments use, because both read
 * the same agent message-store — with authorship resolved from each message's
 * `authorId` (the opening post is stored `role:'assistant'` yet human-authored,
 * so the role is never used for attribution). Replies arrive reactively
 * through the transcript query; agent replies show up the same way.
 */
export function DiscussionThreadView({
  organizationId,
  projectId,
  threadId,
  onBack,
}: DiscussionThreadViewProps) {
  const { t } = useT('discussions');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);

  const { data: discussion } = useDiscussion(organizationId, threadId);
  const { data: messages } = useDiscussionMessages(organizationId, threadId);
  const { resolveActor, currentUserId } = useActorDirectory(
    organizationId,
    String(projectId),
  );
  const { formatRelative, formatDate } = useFormatDate();

  const { mutateAsync: postReply } = usePostReply();
  const { mutateAsync: setStatus } = useSetDiscussionStatus();
  const { mutateAsync: createTask } = useCreateTaskFromDiscussion();

  const status = toDiscussionStatus(discussion?.discussionStatus);
  const isLocked = status === 'locked';
  const category = discussion?.discussionCategory;
  // A discussion converts to a task exactly once (GitHub "convert to issue").
  // Once linked, the convert action becomes "View task".
  const linkedTaskId = discussion?.linkedTaskId ?? null;

  // Keep the newest message in view: the transcript is a conversation, so it
  // opens (and stays) scrolled to its tail as replies arrive.
  const transcriptRef = useRef<HTMLDivElement>(null);
  const messageCount = messages?.length ?? 0;
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messageCount]);

  /**
   * Avatar kind + display name from a message's persisted author identity.
   * Tries the member directory first, then agents; an unresolvable id (removed
   * member, legacy row) falls back to the stored role's presentation.
   */
  const classifyAuthor = useCallback(
    (
      authorId: string | undefined,
      role: 'user' | 'assistant',
    ): { type: 'user' | 'agent'; name?: string } => {
      const fallback = { type: role === 'user' ? 'user' : 'agent' } as const;
      if (!authorId) return fallback;
      const asUser = resolveActor('user', authorId);
      if (asUser.name !== authorId) return { type: 'user', name: asUser.name };
      const asAgent = resolveActor('agent', authorId);
      if (asAgent.name !== authorId) {
        return { type: 'agent', name: asAgent.name };
      }
      return fallback;
    },
    [resolveActor],
  );

  const submitReply = useCallback(async () => {
    const message = draft.trim();
    if (!message || isSending || isLocked) return;
    setIsSending(true);
    try {
      const result = await postReply({ organizationId, threadId, message });
      toastUnresolvedMentions(result.unresolvedMentionTokens, toast, tCommon);
      setDraft('');
    } catch (error) {
      console.error('Failed to post discussion reply', error);
      toast({ title: t('reply.failed'), variant: 'destructive' });
    } finally {
      setIsSending(false);
    }
  }, [
    draft,
    isSending,
    isLocked,
    postReply,
    organizationId,
    threadId,
    t,
    tCommon,
  ]);

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

  // Submit on ⌘/Ctrl+Enter; a bare Enter stays a newline (replies are prose).
  const onModEnter = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submitReply();
    }
  };

  return (
    <Stack gap={0} className="h-full">
      <Row
        gap={3}
        justify="between"
        className="border-border min-h-13 border-b px-5 py-2"
      >
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
            <Button variant="secondary" onClick={goToTask}>
              <ListChecks className="mr-1 size-4" />
              {t('spawnTask.viewTask')}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void handleSpawnTask()}>
              <ListPlus className="mr-1 size-4" />
              {t('spawnTask.cta')}
            </Button>
          )}
          {status !== 'resolved' ? (
            <Button
              variant="secondary"
              onClick={() => void handleSetStatus('resolved')}
            >
              <CheckCircle2 className="mr-1 size-4" />
              {t('resolve')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => void handleSetStatus('open')}
            >
              <RotateCcw className="mr-1 size-4" />
              {t('reopen')}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => void handleSetStatus(isLocked ? 'open' : 'locked')}
          >
            <Lock className="mr-1 size-4" />
            {isLocked ? t('unlock') : t('lock')}
          </Button>
        </HStack>
      </Row>

      <div
        ref={transcriptRef}
        role="log"
        aria-label={t('aria.transcript')}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
      >
        <Stack as="ul" gap={4}>
          {messageCount === 0 && (
            <li>
              <Text as="p" variant="muted">
                {t('empty')}
              </Text>
            </li>
          )}
          {(messages ?? []).map((message) => {
            if (message.authorId === 'system') {
              return (
                <li key={message.messageId} className="text-center">
                  <Text
                    as="p"
                    variant="caption"
                    className="text-muted-foreground text-xs"
                  >
                    {message.body}
                  </Text>
                </li>
              );
            }
            const author = classifyAuthor(message.authorId, message.role);
            const isOwn = !!currentUserId && message.authorId === currentUserId;
            const name = isOwn
              ? resolveActor('user', currentUserId).name
              : author.name;
            return (
              <li key={message.messageId}>
                <Row gap={2} align="start">
                  <AssigneeAvatar
                    assigneeType={author.type}
                    assigneeId={message.authorId}
                    name={name}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
                      <span className="text-foreground font-medium">
                        {name ?? message.authorId}
                      </span>
                      <span aria-hidden="true">·</span>
                      <time
                        dateTime={new Date(message.createdAt).toISOString()}
                        title={formatDate(new Date(message.createdAt), 'long')}
                      >
                        {formatRelative(new Date(message.createdAt))}
                      </time>
                    </div>
                    <MentionText
                      body={message.body}
                      organizationId={organizationId}
                      projectId={projectId}
                      className="mt-0.5 wrap-break-word"
                    />
                  </div>
                </Row>
              </li>
            );
          })}
        </Stack>
      </div>

      <Stack gap={2} className="border-border border-t px-5 py-3">
        <MentionTextarea
          id={`discussion-reply-${threadId}`}
          organizationId={organizationId}
          projectId={projectId}
          rows={2}
          value={draft}
          onValueChange={setDraft}
          onKeyDown={onModEnter}
          placeholder={
            isLocked ? t('reply.lockedPlaceholder') : t('reply.placeholder')
          }
          disabled={isLocked}
          aria-describedby={`discussion-reply-hint-${threadId}`}
        />
        <Text
          as="p"
          id={`discussion-reply-hint-${threadId}`}
          variant="caption"
          className="text-muted-foreground text-xs"
        >
          {t('reply.hint')}
        </Text>
        <MentionTriggerChips
          organizationId={organizationId}
          target={{ projectId }}
          draft={draft}
        />
        <Row gap={0} align="stretch" justify="end">
          <Button
            disabled={draft.trim().length === 0 || isSending || isLocked}
            onClick={() => void submitReply()}
          >
            {t('reply.send')}
          </Button>
        </Row>
      </Stack>
    </Stack>
  );
}
