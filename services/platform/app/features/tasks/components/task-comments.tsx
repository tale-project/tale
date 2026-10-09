'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { SendButton } from '@tale/ui/send-button';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { THREAD_COMPOSER_FRAME_CLASS } from '@tale/ui/thread/layout';
import { ThreadMessage } from '@tale/ui/thread/thread-message';
import { ThreadTime } from '@tale/ui/thread/thread-time';
import { useIsMac } from '@tale/ui/use-is-mac';
import { toast } from '@tale/ui/use-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { useCallback, memo, useRef, useState } from 'react';

import { useCurrentUser } from '@/app/hooks/use-current-user';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useT } from '@/lib/i18n/client';
import { toastUnresolvedMentions } from '@/lib/shared/mention-unresolved';

import {
  useAddTaskComment,
  useDeleteTaskComment,
  useEditTaskComment,
} from '../hooks/mutations';
import {
  useTaskActorDirectory,
  withTaskActorDirectory,
} from '../hooks/task-actor-directory-context';
import { taskCommentDraftKey } from '../lib/draft-key';
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

/** A comment saved naming nobody: its typed `@handle`s name nobody either. */
const NO_SAVED_MENTIONS: NonNullable<TaskCommentData['mentions']> = [];

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
export const TaskCommentView = withTaskActorDirectory(TaskCommentViewContent);

function TaskCommentViewContent({
  comment: c,
  organizationId,
  projectId,
  canComment,
  canWork = false,
  currentUserId,
  isAdmin,
  continuation = false,
  timeFormat = 'relative',
  onRequestDelete,
}: {
  comment: TaskCommentData;
  organizationId: string;
  projectId: string;
  canComment: boolean;
  /** Whether the viewer may work the task — the gate an admin's moderation
   * of someone else's comment passes. Authors change their own comments
   * with the read access posting took. */
  canWork?: boolean;
  currentUserId?: string;
  isAdmin?: boolean;
  /** The same author again, minutes after their previous comment with
   * nothing between: no identity row, a tighter gap. */
  continuation?: boolean;
  /** `time` under a day divider; `relative` where nothing names the day. */
  timeFormat?: 'time' | 'relative';
  onRequestDelete: (messageId: string) => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { locale } = useLocale();
  const { resolveActor, resolveActorPreview } = useTaskActorDirectory(
    organizationId,
    projectId,
  );
  const [editing, setEditing] = useState(false);

  const author = resolveActor(c.authorType, c.authorId);
  const preview = isPreviewableTaskActor(c.authorType, c.authorId)
    ? resolveActorPreview(c.authorType, c.authorId)
    : null;
  const displayBody = pickCommentBody(c.body, c.bodyByLocale, locale);
  const own =
    c.authorType === 'user' &&
    currentUserId !== undefined &&
    c.authorId === currentUserId;
  const canManage = canComment && own;
  const canDelete = canManage || (canComment && canWork && isAdmin === true);

  const actions =
    !editing && (canManage || canDelete) ? (
      <>
        {canManage && (
          <IconButton
            icon={Pencil}
            size="sm"
            variant="ghost"
            aria-label={tCommon('actions.edit')}
            onClick={() => setEditing(true)}
            className="text-muted-foreground hover:text-foreground size-7"
          />
        )}
        {canDelete && (
          <IconButton
            icon={Trash2}
            size="sm"
            variant="ghost"
            aria-label={tCommon('actions.delete')}
            onClick={() => onRequestDelete(c.messageId)}
            className="text-muted-foreground hover:text-destructive size-7"
          />
        )}
      </>
    ) : undefined;

  return (
    <ThreadMessage
      variant={own && !editing ? 'own' : 'other'}
      continuation={continuation}
      // Keep offscreen history in the DOM for browser find, keyboard access
      // and draft state, while letting the browser skip its layout/paint.
      // Editing needs normal layout so its mention menu may overflow the row.
      className={cn(
        'group/comment',
        !editing &&
          '[contain-intrinsic-block-size:auto_8rem] [content-visibility:auto]',
      )}
      avatar={
        <AssigneeAvatar
          assigneeType={c.authorType}
          assigneeId={c.authorId}
          name={author.name}
        />
      }
      author={<TaskActorName preview={preview} name={author.name} />}
      badge={
        c.authorType === 'agent' ? (
          <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
            {t('comment.agentBadge')}
          </Badge>
        ) : undefined
      }
      time={<ThreadTime value={c.createdAt} format={timeFormat} />}
      meta={
        c.editedAt != null ? (
          <span className="italic">({t('comment.edited')})</span>
        ) : undefined
      }
      actions={actions}
      // A long body — an agent's report, a pasted log — reads at a glance and
      // opens in place.
      {...(editing ? {} : { clampHeight: own ? 384 : 320 })}
    >
      {editing ? (
        <TaskCommentEditor
          comment={c}
          organizationId={organizationId}
          projectId={projectId}
          initialBody={displayBody}
          onClose={() => setEditing(false)}
        />
      ) : (
        <MentionText
          body={displayBody}
          organizationId={organizationId}
          projectId={projectId}
          mentions={c.mentions ?? NO_SAVED_MENTIONS}
          className="wrap-break-word"
        />
      )}
    </ThreadMessage>
  );
}

/** A read-only comment creates no mutation observer or edit draft. The
 * editor stays mounted while editing, including when scrolled offscreen. */
const TaskCommentEditor = memo(
  function TaskCommentEditor({
    comment: c,
    organizationId,
    projectId,
    initialBody,
    onClose,
  }: {
    comment: TaskCommentData;
    organizationId: string;
    projectId: string;
    initialBody: string;
    onClose: () => void;
  }) {
    const { t: tCommon } = useT('common');
    const editComment = useEditTaskComment();
    const [editDraft, setEditDraft] = useState(initialBody);
    const isEditPending = editComment.isPending;
    const submitEdit = async () => {
      const body = editDraft.trim();
      if (!body || isEditPending) return;
      try {
        await editComment.mutateAsync({ messageId: c.messageId, body });
        onClose();
      } catch (error) {
        // The comment write's own toast reports the failure.
        console.error('[tasks] comment action failed', error);
      }
    };

    return (
      <Stack gap={2} className="mt-1">
        <MentionTextarea
          id={`edit-comment-${c.messageId}`}
          organizationId={organizationId}
          projectId={projectId}
          mentions={c.mentions ?? NO_SAVED_MENTIONS}
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
          <Button variant="secondary" onClick={onClose}>
            {tCommon('actions.cancel')}
          </Button>
        </Row>
      </Stack>
    );
  },
  (previous, next) =>
    previous.comment.messageId === next.comment.messageId &&
    previous.comment.body === next.comment.body &&
    previous.comment.editedAt === next.comment.editedAt &&
    previous.organizationId === next.organizationId &&
    previous.projectId === next.projectId &&
    previous.initialBody === next.initialBody,
);

/**
 * The task page's composer while its task is on the way: the same frame with
 * the field's room kept and the send masked, inside the page's Skeletonize —
 * so the composer doesn't pop in under the thread when the task arrives.
 */
export function TaskCommentComposerSkeleton() {
  const { t } = useT('tasks');
  return (
    <Stack gap={2} className={cn(THREAD_COMPOSER_FRAME_CLASS, 'pb-3')}>
      <div className="min-h-[44px]" />
      <Row gap={2} align="center" justify="between">
        <Text as="p" variant="caption" className="w-28 max-md:invisible">
          <SkeletonText />
        </Text>
        <SendButton
          label={t('actions.comment')}
          onClick={() => undefined}
          disabled
        />
      </Row>
    </Stack>
  );
}

/**
 * Writing a comment: the mention-aware field, the "who will this wake"
 * chips, and the send — in the same frame as a chat's composer, with a round
 * send button inside it, pinned at the foot of the task's thread on its page
 * and in the board's dialog.
 */
export function TaskCommentComposer({
  taskId,
  organizationId,
  projectId,
  hint,
  className,
}: {
  taskId: string;
  organizationId: string;
  projectId: string;
  hint?: string;
  className?: string;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const addComment = useAddTaskComment();
  const isMac = useIsMac();
  const { data: me } = useCurrentUser();
  // Kept per task, like a chat's draft: leaving the task never loses it.
  const [draft, setDraft, clearDraft] = usePersistedState(
    taskCommentDraftKey(me?.userId, organizationId, taskId),
    '',
  );
  const isAdding = addComment.isPending;
  const empty = draft.trim().length === 0;
  const draftRevision = useRef(0);

  const submit = async () => {
    const body = draft.trim();
    if (!body || isAdding) return;
    const submittedRevision = draftRevision.current;
    try {
      const result = await addComment.mutateAsync({ taskId, body });
      toastUnresolvedMentions(result.unresolvedMentionTokens, toast, tCommon);
      if (draftRevision.current === submittedRevision) clearDraft();
    } catch (error) {
      // The comment write's own toast reports the failure.
      console.error('[tasks] comment action failed', error);
    }
  };

  const field = (
    <MentionTextarea
      id="new-comment"
      organizationId={organizationId}
      projectId={projectId}
      rows={2}
      value={draft}
      onValueChange={(value) => {
        draftRevision.current += 1;
        setDraft(value);
      }}
      onKeyDown={onModEnter(() => {
        if (!isAdding) void submit();
      })}
      // Its own name: the placeholder is a hint and goes once you type.
      aria-label={t('actions.comment')}
      placeholder={t('actions.commentPlaceholder')}
      aria-describedby={hint ? 'new-comment-hint' : undefined}
      className="min-h-[44px] resize-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
    />
  );

  return (
    <Stack
      gap={2}
      className={cn(THREAD_COMPOSER_FRAME_CLASS, 'pb-3', className)}
    >
      {field}
      <MentionTriggerChips
        organizationId={organizationId}
        projectId={projectId}
        target={{ taskId }}
        draft={draft}
      />
      <Row gap={2} align="center" justify="between">
        <Text
          as="p"
          id={hint ? 'new-comment-hint' : undefined}
          variant="caption"
          // A hint is an instruction and wraps in full; the keyboard
          // shortcut is one short line, and means nothing on a phone's touch
          // keyboard. The send button keeps its place either way.
          className={cn('min-w-0', !hint && 'truncate max-md:invisible')}
        >
          {hint ??
            t('actions.commentShortcut', {
              shortcut: isMac ? '⌘ Enter' : 'Ctrl + Enter',
            })}
        </Text>
        <SendButton
          label={t('actions.comment')}
          onClick={() => void submit()}
          disabled={empty}
          sending={isAdding}
        />
      </Row>
    </Stack>
  );
}

/** Confirms a comment delete — one dialog per list, not per comment. */
export function useTaskCommentDelete() {
  const { t } = useT('tasks');
  const deleteComment = useDeleteTaskComment();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const requestDelete = useCallback((messageId: string) => {
    setPendingDeleteId(messageId);
  }, []);

  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteComment.mutateAsync({ messageId: pendingDeleteId });
      setPendingDeleteId(null);
    } catch (error) {
      // The comment write's own toast reports the failure.
      console.error('[tasks] comment action failed', error);
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

  return { requestDelete, pendingDeleteId, dialog };
}
