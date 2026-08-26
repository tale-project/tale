'use client';

import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { toastUnresolvedMentions } from '@/lib/shared/mention-unresolved';
import { cn } from '@/lib/utils/cn';

import {
  useAddTaskComment,
  useDeleteTaskComment,
  useEditTaskComment,
} from '../hooks/mutations';
import { useTaskDiscussion } from '../hooks/queries';
import { useActorDirectory } from '../hooks/use-actor-directory';
import {
  pickCommentBody,
  type CommentBodyByLocale,
} from '../utils/pick-comment-body';
import { isPreviewableTaskActor } from '../utils/task-actor-preview';
import { AssigneeAvatar } from './assignee-avatar';
import { MentionText } from './mention-text';
import { MentionTextarea } from './mention-textarea';
import { MentionTriggerChips } from './mention-trigger-chips';
import { TaskActorName } from './task-actor-preview-popover';

/**
 * A task comment in the unified model: a `task_discussion` message joined with
 * its side-car meta (pre-joined by `getTaskDiscussion` — no render-time lookup).
 * `messageId` is the agent message-store id (an opaque string, not a Convex id).
 */
interface TaskComment {
  messageId: string;
  authorType: 'user' | 'agent';
  authorId: string;
  body: string;
  createdAt: number;
  editedAt?: number;
  mentions?: Array<{ type: 'user' | 'agent' | 'automation'; id: string }>;
  bodyByLocale?: CommentBodyByLocale;
}

/**
 * Task comment thread, unified onto the task's `task_discussion` thread (one
 * conversation surface shared with project discussions). A flat message list —
 * author identity (resolved name + avatar), relative timestamps, the `(edited)`
 * marker, and inline edit/delete. Composer + edit are gated on `canComment`
 * (read-level — any org member who can open the task, mirroring a project
 * discussion reply); edit is author-only; delete is author-or-admin (all
 * re-enforced server-side). Agent replies (from `run_on_task`) render as
 * agent-authored messages here. A task with no comments yet shows just the
 * composer.
 *
 * NEWEST FIRST by default, composer on top. A task's discussion is not a chat:
 * most of its volume is automated reports a run files (a desk's summary runs to
 * hundreds of lines), so oldest-first buried both the current state and the box
 * to answer it under a wall of history — and it contradicted the Activity list
 * right below, which has always been newest-first. A conversational surface can
 * still opt into `order="asc"`.
 */
export function TaskComments({
  taskId,
  organizationId,
  projectId,
  canComment,
  currentUserId,
  isAdmin,
  showHeading = true,
  order = 'desc',
  composerHint,
}: {
  taskId: Id<'tasks'>;
  organizationId: string;
  projectId: Id<'projects'>;
  canComment: boolean;
  currentUserId?: string;
  isAdmin?: boolean;
  /** When false, omit the "Comments (N)" title (e.g. parent disclosure owns it). */
  showHeading?: boolean;
  /** `desc` (default) puts the newest comment first — the actionable state of
   *  a task, and what the composer answers. `asc` reads as a conversation, for
   *  a surface whose messages are short and mutually referring. */
  order?: 'asc' | 'desc';
  /** Contextual note under the composer (also the textarea's accessible
   *  description) — e.g. "a run is in progress and won't see new comments". */
  composerHint?: string;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { locale } = useLocale();
  const { comments: timeline } = useTaskDiscussion(taskId);
  const comments = order === 'desc' ? timeline.toReversed() : timeline;
  const { resolveActor, resolveActorPreview } = useActorDirectory(
    organizationId,
    projectId,
  );
  const { formatRelative, formatDate } = useFormatDate();

  const addComment = useAddTaskComment();
  const editComment = useEditTaskComment();
  const deleteComment = useDeleteTaskComment();

  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Submit on ⌘/Ctrl+Enter; a bare Enter stays a newline (comments are prose).
  const onModEnter =
    (submit: () => void) => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    };

  const onError = (error: unknown) => {
    console.error('[tasks] comment action failed', error);
    toast({ title: tCommon('errors.generic'), variant: 'destructive' });
  };

  const isAdding = addComment.isPending;
  const isEditPending = editComment.isPending;

  const submitNew = async () => {
    const body = draft.trim();
    if (!body || isAdding) return;
    try {
      const result = await addComment.mutateAsync({ taskId, body });
      toastUnresolvedMentions(result.unresolvedMentionTokens, toast, tCommon);
      setDraft('');
    } catch (error) {
      onError(error);
    }
  };

  const submitEdit = async (messageId: string) => {
    const body = editDraft.trim();
    if (!body || isEditPending) return;
    try {
      await editComment.mutateAsync({ messageId, body });
      setEditingId(null);
    } catch (error) {
      onError(error);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteComment.mutateAsync({ messageId: pendingDeleteId });
      setPendingDeleteId(null);
    } catch (error) {
      onError(error);
    }
  };

  const canManage = (c: TaskComment) =>
    c.authorType === 'user' && !!currentUserId && c.authorId === currentUserId;

  const renderItem = (c: TaskComment) => {
    const author = resolveActor(c.authorType, c.authorId);
    const preview = isPreviewableTaskActor(c.authorType, c.authorId)
      ? resolveActorPreview(c.authorType, c.authorId)
      : null;
    const isEditingThisComment = editingId === c.messageId;
    const displayBody = pickCommentBody(c.body, c.bodyByLocale, locale);
    return (
      <Row gap={2} align="start" className="group/comment">
        <AssigneeAvatar
          assigneeType={c.authorType}
          assigneeId={c.authorId}
          name={author.name}
        />
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
            <TaskActorName preview={preview} name={author.name} />
            <span aria-hidden="true">·</span>
            <time
              dateTime={new Date(c.createdAt).toISOString()}
              title={formatDate(new Date(c.createdAt), 'long')}
            >
              {formatRelative(new Date(c.createdAt))}
            </time>
            {c.editedAt != null && (
              <span className="italic">({t('comment.edited')})</span>
            )}
          </div>

          {isEditingThisComment ? (
            <Stack gap={2} className="mt-1">
              <MentionTextarea
                id={`edit-comment-${c.messageId}`}
                organizationId={organizationId}
                projectId={projectId}
                rows={2}
                value={editDraft}
                onValueChange={setEditDraft}
                onKeyDown={onModEnter(() => {
                  if (!isEditPending) void submitEdit(c.messageId);
                })}
                autoFocus
              />
              <Row gap={2} align="stretch">
                <Button
                  disabled={editDraft.trim().length === 0 || isEditPending}
                  isLoading={isEditPending}
                  onClick={() => void submitEdit(c.messageId)}
                >
                  {tCommon('actions.save')}
                </Button>
                <Button variant="secondary" onClick={() => setEditingId(null)}>
                  {tCommon('actions.cancel')}
                </Button>
              </Row>
            </Stack>
          ) : (
            <MentionText
              body={displayBody}
              organizationId={organizationId}
              projectId={projectId}
              className="mt-0.5 wrap-break-word"
            />
          )}

          {!isEditingThisComment && canComment && (
            <Row
              gap={3}
              className="mt-1 text-xs opacity-0 transition-opacity group-focus-within/comment:opacity-100 group-hover/comment:opacity-100"
            >
              {canManage(c) && (
                <CommentAction
                  onClick={() => {
                    setEditingId(c.messageId);
                    setEditDraft(displayBody);
                  }}
                >
                  {tCommon('actions.edit')}
                </CommentAction>
              )}
              {(canManage(c) || isAdmin) && (
                <CommentAction
                  destructive
                  onClick={() => setPendingDeleteId(c.messageId)}
                >
                  {tCommon('actions.delete')}
                </CommentAction>
              )}
            </Row>
          )}
        </div>
      </Row>
    );
  };

  // The composer sits at the NEWEST end of the thread — below an ascending
  // conversation, above a newest-first log — so a fresh comment appears where
  // it was typed.
  const composer = canComment && (
    <Stack gap={2} className={order === 'desc' ? 'mt-3 mb-4' : 'mt-4'}>
      <MentionTextarea
        id="new-comment"
        organizationId={organizationId}
        projectId={projectId}
        rows={2}
        value={draft}
        onValueChange={setDraft}
        onKeyDown={onModEnter(() => {
          if (!isAdding) void submitNew();
        })}
        placeholder={t('actions.comment')}
        aria-describedby={composerHint ? 'new-comment-hint' : undefined}
      />
      {composerHint && (
        <Text as="p" id="new-comment-hint" variant="caption">
          {composerHint}
        </Text>
      )}
      <MentionTriggerChips
        organizationId={organizationId}
        target={{ taskId }}
        draft={draft}
      />
      <Row gap={0} align="stretch" justify="end">
        <Button
          disabled={draft.trim().length === 0 || isAdding}
          isLoading={isAdding}
          onClick={() => void submitNew()}
        >
          {t('actions.comment')}
        </Button>
      </Row>
    </Stack>
  );

  return (
    <section>
      {showHeading ? (
        <Text as="h3" variant="label">
          {t('detail.comments')} ({comments.length})
        </Text>
      ) : null}

      {order === 'desc' && composer}

      <Stack as="ul" className={showHeading ? 'mt-3' : undefined}>
        {comments.length === 0 && (
          <li>
            <Text as="p" variant="muted">
              {t('detail.noComments')}
            </Text>
          </li>
        )}
        {comments.map((c) => (
          <li key={c.messageId}>{renderItem(c)}</li>
        ))}
      </Stack>

      {order === 'asc' && composer}

      <DeleteDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title={t('comment.deleteConfirm')}
        isDeleting={deleteComment.isPending}
        onDelete={() => void confirmDelete()}
      />
    </section>
  );
}

function CommentAction({
  children,
  onClick,
  destructive,
}: {
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-muted-foreground hover:text-foreground font-medium transition-colors',
        destructive && 'hover:text-destructive',
      )}
    >
      {children}
    </button>
  );
}
