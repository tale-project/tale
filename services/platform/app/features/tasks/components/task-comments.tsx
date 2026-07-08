'use client';

import { Button } from '@tale/ui/button';
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
import { isPreviewableTaskActor } from '../utils/task-actor-preview';
import { AssigneeAvatar } from './assignee-avatar';
import { TaskActorName } from './task-actor-preview-popover';
import { MentionText } from './mention-text';
import { MentionTextarea } from './mention-textarea';
import { MentionTriggerChips } from './mention-trigger-chips';

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
  mentions?: Array<{ type: 'user' | 'agent'; id: string }>;
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
 */
export function TaskComments({
  taskId,
  organizationId,
  projectId,
  canComment,
  currentUserId,
  isAdmin,
}: {
  taskId: Id<'tasks'>;
  organizationId: string;
  projectId: Id<'projects'>;
  canComment: boolean;
  currentUserId?: string;
  isAdmin?: boolean;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { comments } = useTaskDiscussion(taskId);
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

  const currentUser = currentUserId
    ? resolveActor('user', currentUserId)
    : null;

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

  const submitNew = async () => {
    const body = draft.trim();
    if (!body) return;
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
    if (!body) return;
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
    const isEditing = editingId === c.messageId;
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

          {isEditing ? (
            <Stack gap={2} className="mt-1">
              <MentionTextarea
                id={`edit-comment-${c.messageId}`}
                organizationId={organizationId}
                projectId={projectId}
                rows={2}
                value={editDraft}
                onValueChange={setEditDraft}
                onKeyDown={onModEnter(() => void submitEdit(c.messageId))}
                autoFocus
              />
              <Row gap={2} align="stretch">
                <Button
                  disabled={editDraft.trim().length === 0}
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
              body={c.body}
              organizationId={organizationId}
              projectId={projectId}
              className="mt-0.5 wrap-break-word whitespace-pre-wrap"
            />
          )}

          {!isEditing && canComment && (
            <Row
              gap={3}
              className="mt-1 text-xs opacity-0 transition-opacity group-focus-within/comment:opacity-100 group-hover/comment:opacity-100"
            >
              {canManage(c) && (
                <CommentAction
                  onClick={() => {
                    setEditingId(c.messageId);
                    setEditDraft(c.body);
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

  return (
    <section>
      <Text as="h3" variant="label">
        {t('detail.comments')} ({comments.length})
      </Text>

      <Stack as="ul" className="mt-3">
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

      {canComment && (
        <Row gap={2} align="start" className="mt-4">
          {currentUser && (
            <AssigneeAvatar
              assigneeType="user"
              assigneeId={currentUser.id}
              name={currentUser.name}
            />
          )}
          <Stack gap={2} className="min-w-0 flex-1">
            <MentionTextarea
              id="new-comment"
              organizationId={organizationId}
              projectId={projectId}
              rows={2}
              value={draft}
              onValueChange={setDraft}
              onKeyDown={onModEnter(() => void submitNew())}
              placeholder={t('actions.comment')}
            />
            <MentionTriggerChips
              organizationId={organizationId}
              target={{ taskId }}
              draft={draft}
            />
            <Row gap={0} align="stretch" justify="end">
              <Button
                disabled={draft.trim().length === 0}
                onClick={() => void submitNew()}
              >
                {t('actions.comment')}
              </Button>
            </Row>
          </Stack>
        </Row>
      )}

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
