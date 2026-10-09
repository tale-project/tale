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
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  memo,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useCurrentUser } from '@/app/hooks/use-current-user';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useT } from '@/lib/i18n/client';
import { toastUnresolvedMentions } from '@/lib/shared/mention-unresolved';

import {
  useAddTaskComment,
  useDeleteTaskComment,
  useEditTaskComment,
} from '../hooks/mutations';
import { useTaskDiscussion } from '../hooks/queries';
import {
  useTaskActorDirectory,
  withTaskActorDirectory,
} from '../hooks/task-actor-directory-context';
import { useFirstFrameSlice } from '../hooks/use-first-frame-slice';
import { useTaskHistoryAnchor } from '../hooks/use-task-history-anchor';
import {
  TaskLogRow,
  useTaskLogRowActivity,
  useTaskLogWindow,
} from '../hooks/use-task-log-window';
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
import { TaskHistoryEarlierButton } from './task-history-earlier-button';

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

/** How many comments the opening frame of a discussion renders: more than a
 * screen holds. The remaining history enters its window in a background pass. */
const FIRST_FRAME_COMMENTS = 20;

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
  useTaskLogRowActivity(editing);

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
      rows={compact && empty ? 1 : 2}
      value={draft}
      onValueChange={(value) => {
        draftRevision.current += 1;
        setDraft(value);
      }}
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
            // A keyboard shortcut means nothing on a phone's touch keyboard;
            // the send button keeps its place either way.
            className={cn('min-w-0 truncate', !hint && 'max-md:invisible')}
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
        projectId={projectId}
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

type SetCommentRowActive = ReturnType<typeof useTaskLogWindow>['setRowActive'];

/** Confirms a comment delete — one dialog per list, not per comment. */
export function useTaskCommentDelete(setRowActive?: SetCommentRowActive) {
  const { t } = useT('tasks');
  const deleteComment = useDeleteTaskComment();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleteSource, setDeleteSource] = useState<{
    messageId: string;
    generation: number;
  } | null>(null);
  const source = useId();
  const deleteSourceId = useRef<string | null>(null);
  const deleteGeneration = useRef(0);
  const releaseFrame = useRef(0);
  const requestDelete = useCallback(
    (messageId: string) => {
      const generation = ++deleteGeneration.current;
      cancelAnimationFrame(releaseFrame.current);
      releaseFrame.current = 0;
      if (setRowActive) {
        const previous = deleteSourceId.current;
        deleteSourceId.current = messageId;
        setRowActive(messageId, source, true);
        if (previous !== null && previous !== messageId) {
          setRowActive(previous, source, false);
        }
        setDeleteSource({ messageId, generation });
      }
      setPendingDeleteId(messageId);
    },
    [setRowActive, source],
  );
  const releaseDeleteSource = useCallback(() => {
    if (
      pendingDeleteId !== null ||
      deleteSource === null ||
      !setRowActive ||
      deleteGeneration.current !== deleteSource.generation
    )
      return;
    // Close autofocus has now run. Keep its newly focused opener mounted
    // until the virtual list's focus pin and measurements have settled.
    cancelAnimationFrame(releaseFrame.current);
    releaseFrame.current = requestAnimationFrame(() => {
      releaseFrame.current = requestAnimationFrame(() => {
        if (deleteGeneration.current !== deleteSource.generation) return;
        deleteSourceId.current = null;
        releaseFrame.current = 0;
        setRowActive(deleteSource.messageId, source, false);
        setDeleteSource(null);
      });
    });
  }, [deleteSource, pendingDeleteId, setRowActive, source]);
  useEffect(
    () => () => {
      deleteGeneration.current++;
      cancelAnimationFrame(releaseFrame.current);
      const messageId = deleteSourceId.current;
      deleteSourceId.current = null;
      if (messageId !== null) setRowActive?.(messageId, source, false);
    },
    [setRowActive, source],
  );

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
      onCloseAutoFocus={releaseDeleteSource}
    />
  );

  return { requestDelete, pendingDeleteId, dialog };
}

/**
 * Task comment thread, unified onto the task's `task_discussion` thread (one
 * conversation surface shared with project discussions). A flat message list —
 * author identity (resolved name + avatar), relative timestamps, the `(edited)`
 * marker, and inline edit/delete. The composer is gated on `canComment`
 * (read-level — any org member who can open the task, mirroring a project
 * discussion reply), and so are an author's edit and delete of their own
 * comment; an admin's delete of someone else's also needs `canWork`, the
 * task's work gate (all re-enforced server-side). Agent replies (from
 * `run_on_task`) render as
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
export const TaskComments = withTaskActorDirectory(TaskCommentsContent);

function TaskCommentsContent({
  taskId,
  organizationId,
  projectId,
  canComment,
  canWork = false,
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
  /** The viewer may work the task: an admin's moderation passes it. */
  canWork?: boolean;
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
  const comments = useMemo(
    () => (order === 'desc' ? newestFirst : newestFirst.toReversed()),
    [newestFirst, order],
  );
  // Keep ascending conversations whole so adding rows above their newest
  // end does not move the page under its reader.
  const shownComments = useFirstFrameSlice(
    comments,
    order === 'desc' ? FIRST_FRAME_COMMENTS : Number.POSITIVE_INFINITY,
    taskId,
  );
  const getItemKey = useCallback(
    (index: number) => shownComments[index]?.messageId ?? `comment-${index}`,
    [shownComments],
  );
  const estimateSize = useCallback(
    (index: number) => {
      const bodyLength = shownComments[index]?.body.length ?? 0;
      return Math.max(96, Math.min(800, 64 + Math.ceil(bodyLength / 75) * 20));
    },
    [shownComments],
  );
  const window = useTaskLogWindow({
    count: shownComments.length,
    getItemKey,
    estimateSize,
    gap: 16,
  });
  const { requestDelete, dialog: deleteDialog } = useTaskCommentDelete(
    window.setRowActive,
  );
  const { historyRef, loadEarlierWithAnchor } = useTaskHistoryAnchor(
    newestFirst.at(-1)?.messageId,
    loadEarlier,
    isLoadingEarlier,
  );

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
      <TaskHistoryEarlierButton
        isLoading={isLoadingEarlier}
        onLoadEarlier={loadEarlierWithAnchor}
      />
    </Row>
  );

  return (
    <section ref={historyRef}>
      {showHeading ? (
        <Text as="h3" variant="label">
          {t('detail.comments')} ({commentCount ?? comments.length})
        </Text>
      ) : null}

      {order === 'desc' && composer}
      {order === 'asc' && earlier}

      <Stack
        as="ul"
        ref={window.listRef}
        gap={0}
        className={showHeading ? 'mt-3' : undefined}
      >
        {comments.length === 0 && !canComment && (
          <li>
            <Text as="p" variant="muted">
              {t('detail.noComments')}
            </Text>
          </li>
        )}
        {window.items.map((row) => {
          const c = shownComments[row.index];
          if (!c) return null;
          return (
            <Fragment key={row.key}>
              {row.paddingBefore > 0 && (
                <li
                  aria-hidden
                  role="presentation"
                  style={{ height: row.paddingBefore, flexShrink: 0 }}
                />
              )}
              <li
                data-index={row.index}
                data-task-history-entry
                ref={window.measureElement}
                onFocusCapture={window.onFocusCapture}
                onBlurCapture={window.onBlurCapture}
                aria-posinset={window.virtualized ? row.index + 1 : undefined}
                aria-setsize={window.virtualized ? comments.length : undefined}
                className={
                  window.virtualized
                    ? undefined
                    : '[content-visibility:auto] focus-within:[content-visibility:visible]'
                }
                style={
                  window.virtualized
                    ? undefined
                    : { containIntrinsicSize: 'auto 160px' }
                }
              >
                <TaskLogRow rowKey={row.key} setRowActive={window.setRowActive}>
                  <TaskCommentView
                    comment={c}
                    organizationId={organizationId}
                    projectId={projectId}
                    canComment={canComment}
                    canWork={canWork}
                    {...(currentUserId !== undefined ? { currentUserId } : {})}
                    {...(isAdmin !== undefined ? { isAdmin } : {})}
                    onRequestDelete={requestDelete}
                  />
                </TaskLogRow>
              </li>
            </Fragment>
          );
        })}
        {window.paddingAfter > 0 && (
          <li
            aria-hidden
            role="presentation"
            style={{ height: window.paddingAfter, flexShrink: 0 }}
          />
        )}
      </Stack>

      {order === 'desc' && earlier}
      {order === 'asc' && composer}

      {deleteDialog}
    </section>
  );
}
