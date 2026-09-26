'use client';

import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useIsMac } from '@tale/ui/use-is-mac';
import { toast } from '@tale/ui/use-toast';
import { ArrowUp } from 'lucide-react';
import { useState } from 'react';

import { CHAT_COMPOSER_FRAME_CLASS } from '@/app/features/chat/lib/layout';
import { useT } from '@/lib/i18n/client';
import { toastUnresolvedMentions } from '@/lib/shared/mention-unresolved';

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
export interface TaskCommentData {
  messageId: string;
  authorType: 'user' | 'agent';
  authorId: string;
  body: string;
  createdAt: number;
  editedAt?: number;
  mentions?: Array<{ type: 'user' | 'agent' | 'automation'; id: string }>;
  bodyByLocale?: CommentBodyByLocale;
}

/** Submit on ⌘/Ctrl+Enter; a bare Enter stays a newline (comments are prose). */
function onModEnter(submit: () => void) {
  return (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };
}

/**
 * One comment: author, time, the `(edited)` marker, the body with its
 * mentions, and — on hover, for whoever may — edit in place and delete. The
 * edit draft is the comment's own state, so any list (the board dialog's log,
 * the task page's conversation) renders comments the same way.
 */
export function TaskCommentView({
  comment: c,
  organizationId,
  projectId,
  canComment,
  currentUserId,
  isAdmin,
  onRequestDelete,
}: {
  comment: TaskCommentData;
  organizationId: string;
  projectId: string;
  canComment: boolean;
  currentUserId?: string;
  isAdmin?: boolean;
  onRequestDelete: (messageId: string) => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { locale } = useLocale();
  const { resolveActor, resolveActorPreview } = useActorDirectory(
    organizationId,
    projectId,
  );
  const { formatRelative, formatDate } = useFormatDate();
  const editComment = useEditTaskComment();
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const isEditPending = editComment.isPending;

  const author = resolveActor(c.authorType, c.authorId);
  const preview = isPreviewableTaskActor(c.authorType, c.authorId)
    ? resolveActorPreview(c.authorType, c.authorId)
    : null;
  const displayBody = pickCommentBody(c.body, c.bodyByLocale, locale);
  const canManage =
    c.authorType === 'user' && !!currentUserId && c.authorId === currentUserId;

  const submitEdit = async () => {
    const body = editDraft.trim();
    if (!body || isEditPending) return;
    try {
      await editComment.mutateAsync({ messageId: c.messageId, body });
      setEditing(false);
    } catch (error) {
      console.error('[tasks] comment action failed', error);
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
    }
  };

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

        {editing ? (
          <Stack gap={2} className="mt-1">
            <MentionTextarea
              id={`edit-comment-${c.messageId}`}
              organizationId={organizationId}
              projectId={projectId}
              rows={2}
              value={editDraft}
              onValueChange={setEditDraft}
              onKeyDown={onModEnter(() => {
                if (!isEditPending) void submitEdit();
              })}
              autoFocus
            />
            <Row gap={2} align="stretch">
              <Button
                disabled={editDraft.trim().length === 0 || isEditPending}
                isLoading={isEditPending}
                onClick={() => void submitEdit()}
              >
                {tCommon('actions.save')}
              </Button>
              <Button variant="secondary" onClick={() => setEditing(false)}>
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

        {!editing && canComment && (
          <Row
            gap={3}
            className="mt-1 text-xs opacity-0 transition-opacity group-focus-within/comment:opacity-100 group-hover/comment:opacity-100"
          >
            {canManage && (
              <CommentAction
                onClick={() => {
                  setEditing(true);
                  setEditDraft(displayBody);
                }}
              >
                {tCommon('actions.edit')}
              </CommentAction>
            )}
            {(canManage || isAdmin) && (
              <CommentAction
                destructive
                onClick={() => onRequestDelete(c.messageId)}
              >
                {tCommon('actions.delete')}
              </CommentAction>
            )}
          </Row>
        )}
      </div>
    </Row>
  );
}

/**
 * Writing a comment: the mention-aware field, the "who will this wake"
 * chips, and the send. `inline` is the board dialog's form (a labelled
 * Comment button under the field); `chat` is the task page's composer — the
 * same frame as the chat's, with a round send button inside it.
 */
export function TaskCommentComposer({
  taskId,
  organizationId,
  projectId,
  hint,
  variant = 'inline',
  compact = false,
  className,
}: {
  taskId: string;
  organizationId: string;
  projectId: string;
  hint?: string;
  variant?: 'inline' | 'chat';
  /** A one-row field while empty (an empty thread's first comment). */
  compact?: boolean;
  className?: string;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const addComment = useAddTaskComment();
  const isMac = useIsMac();
  const [draft, setDraft] = useState('');
  const isAdding = addComment.isPending;
  const empty = draft.trim().length === 0;

  const submit = async () => {
    const body = draft.trim();
    if (!body || isAdding) return;
    try {
      const result = await addComment.mutateAsync({ taskId, body });
      toastUnresolvedMentions(result.unresolvedMentionTokens, toast, tCommon);
      setDraft('');
    } catch (error) {
      console.error('[tasks] comment action failed', error);
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
    }
  };

  const field = (
    <MentionTextarea
      id="new-comment"
      organizationId={organizationId}
      projectId={projectId}
      rows={compact && empty ? 1 : 2}
      value={draft}
      onValueChange={setDraft}
      onKeyDown={onModEnter(() => {
        if (!isAdding) void submit();
      })}
      placeholder={
        variant === 'chat'
          ? t('actions.commentPlaceholder')
          : t('actions.comment')
      }
      aria-describedby={hint ? 'new-comment-hint' : undefined}
      {...(variant === 'chat'
        ? {
            className:
              'min-h-[44px] resize-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
          }
        : {})}
    />
  );

  if (variant === 'chat') {
    return (
      <Stack
        gap={2}
        className={cn(CHAT_COMPOSER_FRAME_CLASS, 'pb-3', className)}
      >
        {field}
        <MentionTriggerChips
          organizationId={organizationId}
          target={{ taskId }}
          draft={draft}
        />
        <Row gap={2} align="center" justify="between">
          <Text
            as="p"
            id={hint ? 'new-comment-hint' : undefined}
            variant="caption"
            className="min-w-0 truncate"
          >
            {hint ??
              t('actions.commentShortcut', {
                shortcut: isMac ? '⌘ Enter' : 'Ctrl + Enter',
              })}
          </Text>
          <Button
            size="icon"
            variant={empty ? 'secondary' : 'primary'}
            disabled={empty || isAdding}
            isLoading={isAdding}
            onClick={() => void submit()}
            aria-label={t('actions.comment')}
            className="size-9 shrink-0 rounded-full transition-transform active:scale-95"
          >
            <ArrowUp className="size-4" />
          </Button>
        </Row>
      </Stack>
    );
  }

  return (
    <Stack gap={2} className={className}>
      {field}
      {hint && (
        <Text as="p" id="new-comment-hint" variant="caption">
          {hint}
        </Text>
      )}
      <MentionTriggerChips
        organizationId={organizationId}
        target={{ taskId }}
        draft={draft}
      />
      <Row gap={0} align="stretch" justify="end">
        <Button
          variant="secondary"
          disabled={empty || isAdding}
          isLoading={isAdding}
          onClick={() => void submit()}
        >
          {t('actions.comment')}
        </Button>
      </Row>
    </Stack>
  );
}

/** Confirms a comment delete — one dialog per list, not per comment. */
export function useTaskCommentDelete() {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const deleteComment = useDeleteTaskComment();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteComment.mutateAsync({ messageId: pendingDeleteId });
      setPendingDeleteId(null);
    } catch (error) {
      console.error('[tasks] comment action failed', error);
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
    }
  };

  const dialog = (
    <DeleteDialog
      open={pendingDeleteId !== null}
      onOpenChange={(open) => {
        if (!open) setPendingDeleteId(null);
      }}
      title={t('comment.deleteConfirm')}
      isDeleting={deleteComment.isPending}
      onDelete={() => void confirmDelete()}
    />
  );

  return { requestDelete: setPendingDeleteId, dialog };
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
 * composer when the viewer can comment — the placeholder teaches; a second
 * "No comments yet" line is omitted (empty-state craft). Read-only empty
 * threads still show that line.
 *
 * NEWEST FIRST by default, composer on top — the board dialog's log, where
 * most of the volume is automated reports a run files. The task page reads
 * the same thread as a conversation instead (`TaskConversation`).
 *
 * The feed is a PAGE WALK from the newest end: the first page holds the latest
 * comments, and a "show earlier comments" control at the oldest end loads the
 * ones before them — so however busy a task gets, its freshest comment is on
 * screen and nothing older is silently cut.
 */
export function TaskComments({
  taskId,
  organizationId,
  projectId,
  canComment,
  currentUserId,
  isAdmin,
  showHeading = true,
  commentCount,
  order = 'desc',
  composerHint,
}: {
  taskId: string;
  organizationId: string;
  projectId: string;
  canComment: boolean;
  currentUserId?: string;
  isAdmin?: boolean;
  /** When false, omit the "Comments (N)" title (e.g. parent disclosure owns it). */
  showHeading?: boolean;
  /** The task's total comment count for the heading (the denormalized
   *  `tasks.commentCount`); the loaded count stands in when absent. */
  commentCount?: number;
  /** `desc` (default) puts the newest comment first — the actionable state of
   *  a task, and what the composer answers. `asc` reads as a conversation, for
   *  a surface whose messages are short and mutually referring. */
  order?: 'asc' | 'desc';
  /** Contextual note under the composer (also the textarea's accessible
   *  description) — e.g. "a run is in progress and won't see new comments". */
  composerHint?: string;
}) {
  const { t } = useT('tasks');
  const {
    comments: newestFirst,
    hasEarlier,
    isLoadingEarlier,
    loadEarlier,
  } = useTaskDiscussion(taskId);
  const comments = order === 'desc' ? newestFirst : newestFirst.toReversed();
  const { requestDelete, dialog: deleteDialog } = useTaskCommentDelete();

  // The composer sits at the NEWEST end of the thread — below an ascending
  // conversation, above a newest-first log — so a fresh comment appears where
  // it was typed. Empty thread: one compact composer (placeholder teaches);
  // no second "No comments yet" line under it (Miller / empty-state craft).
  const threadEmpty = comments.length === 0;
  const composer = canComment && (
    <TaskCommentComposer
      taskId={taskId}
      organizationId={organizationId}
      projectId={projectId}
      compact={threadEmpty}
      {...(composerHint !== undefined ? { hint: composerHint } : {})}
      className={order === 'desc' ? 'mt-3 mb-4' : 'mt-4'}
    />
  );

  // The walk into older pages sits at the OLDEST end of the thread — below a
  // newest-first log, above an ascending conversation.
  const earlier = hasEarlier && (
    <Row gap={0} align="stretch" justify="center" className="my-3">
      <Button
        variant="secondary"
        isLoading={isLoadingEarlier}
        disabled={isLoadingEarlier}
        onClick={loadEarlier}
      >
        {t('detail.showEarlierComments')}
      </Button>
    </Row>
  );

  return (
    <section>
      {showHeading ? (
        <Text as="h3" variant="label">
          {t('detail.comments')} ({commentCount ?? comments.length})
        </Text>
      ) : null}

      {order === 'desc' && composer}
      {order === 'asc' && earlier}

      <Stack as="ul" className={showHeading ? 'mt-3' : undefined}>
        {comments.length === 0 && !canComment && (
          <li>
            <Text as="p" variant="muted">
              {t('detail.noComments')}
            </Text>
          </li>
        )}
        {comments.map((c) => (
          <li key={c.messageId}>
            <TaskCommentView
              comment={c}
              organizationId={organizationId}
              projectId={projectId}
              canComment={canComment}
              {...(currentUserId !== undefined ? { currentUserId } : {})}
              {...(isAdmin !== undefined ? { isAdmin } : {})}
              onRequestDelete={requestDelete}
            />
          </li>
        ))}
      </Stack>

      {order === 'desc' && earlier}
      {order === 'asc' && composer}

      {deleteDialog}
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
