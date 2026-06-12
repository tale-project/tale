'use client';

import { Button } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import { useMemo, useState } from 'react';

import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import type { Doc, Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  useAddTaskComment,
  useDeleteTaskComment,
  useEditTaskComment,
} from '../hooks/mutations';
import { useTaskComments } from '../hooks/queries';
import { useActorDirectory } from '../hooks/use-actor-directory';
import { AssigneeAvatar } from './assignee-avatar';
import { MentionText } from './mention-text';
import { MentionTextarea } from './mention-textarea';
import { MentionTriggerChips } from './mention-trigger-chips';

type CommentDoc = Doc<'taskComments'>;

/**
 * Task comment thread: author identity (resolved name + avatar) and relative
 * timestamps, single-level replies, and inline edit/delete. The same item
 * rendering is reused for top-level comments and replies. Composer + reply +
 * edit are gated on `canEdit` (project write); edit is author-only; delete is
 * author-or-admin (enforced again server-side).
 */
export function TaskComments({
  taskId,
  organizationId,
  projectId,
  canEdit,
  currentUserId,
  isAdmin,
}: {
  taskId: Id<'tasks'>;
  organizationId: string;
  projectId: Id<'projects'>;
  canEdit: boolean;
  currentUserId?: string;
  isAdmin?: boolean;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { comments } = useTaskComments(taskId);
  const { resolveActor } = useActorDirectory(organizationId, projectId);
  const { formatRelative, formatDate } = useFormatDate();

  const addComment = useAddTaskComment();
  const editComment = useEditTaskComment();
  const deleteComment = useDeleteTaskComment();

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Id<'taskComments'> | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [editingId, setEditingId] = useState<Id<'taskComments'> | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const { roots, repliesByParent } = useMemo(() => {
    const ids = new Set(comments.map((c) => c._id));
    const rootList: CommentDoc[] = [];
    const replies = new Map<string, CommentDoc[]>();
    for (const c of comments) {
      // Promote an orphaned reply (its parent was deleted) to a root so it
      // never silently disappears.
      if (c.parentCommentId && ids.has(c.parentCommentId)) {
        const arr = replies.get(c.parentCommentId) ?? [];
        arr.push(c);
        replies.set(c.parentCommentId, arr);
      } else {
        rootList.push(c);
      }
    }
    return { roots: rootList, repliesByParent: replies };
  }, [comments]);

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
      await addComment.mutateAsync({ taskId, body });
      setDraft('');
    } catch (error) {
      onError(error);
    }
  };

  const submitReply = async (parentCommentId: Id<'taskComments'>) => {
    const body = replyDraft.trim();
    if (!body) return;
    try {
      await addComment.mutateAsync({ taskId, body, parentCommentId });
      setReplyDraft('');
      setReplyTo(null);
    } catch (error) {
      onError(error);
    }
  };

  const submitEdit = async (commentId: Id<'taskComments'>) => {
    const body = editDraft.trim();
    if (!body) return;
    try {
      await editComment.mutateAsync({ commentId, body });
      setEditingId(null);
    } catch (error) {
      onError(error);
    }
  };

  const handleDelete = async (commentId: Id<'taskComments'>) => {
    if (!globalThis.confirm(t('comment.deleteConfirm'))) return;
    try {
      await deleteComment.mutateAsync({ commentId });
    } catch (error) {
      onError(error);
    }
  };

  const canManage = (c: CommentDoc) =>
    c.authorType === 'user' && !!currentUserId && c.authorId === currentUserId;

  const renderItem = (c: CommentDoc, isReply: boolean) => {
    const author = resolveActor(c.authorType, c.authorId);
    const isEditing = editingId === c._id;
    return (
      <div className="group/comment flex items-start gap-2">
        <AssigneeAvatar
          assigneeType={c.authorType}
          assigneeId={c.authorId}
          name={author.name}
        />
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
            <span className="text-foreground font-medium">{author.name}</span>
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
            <div className="mt-1 flex flex-col gap-2">
              <MentionTextarea
                id={`edit-comment-${c._id}`}
                organizationId={organizationId}
                projectId={projectId}
                rows={2}
                value={editDraft}
                onValueChange={setEditDraft}
                onKeyDown={onModEnter(() => void submitEdit(c._id))}
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={editDraft.trim().length === 0}
                  onClick={() => void submitEdit(c._id)}
                >
                  {tCommon('actions.save')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditingId(null)}
                >
                  {tCommon('actions.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <MentionText
              body={c.body}
              organizationId={organizationId}
              projectId={projectId}
              className="mt-0.5 wrap-break-word whitespace-pre-wrap"
            />
          )}

          {!isEditing && canEdit && (
            <div className="mt-1 flex items-center gap-3 text-xs opacity-0 transition-opacity group-focus-within/comment:opacity-100 group-hover/comment:opacity-100">
              {!isReply && (
                <CommentAction
                  onClick={() => {
                    setReplyTo(replyTo === c._id ? null : c._id);
                    setReplyDraft('');
                  }}
                >
                  {t('actions.reply')}
                </CommentAction>
              )}
              {canManage(c) && (
                <CommentAction
                  onClick={() => {
                    setEditingId(c._id);
                    setEditDraft(c.body);
                  }}
                >
                  {tCommon('actions.edit')}
                </CommentAction>
              )}
              {(canManage(c) || isAdmin) && (
                <CommentAction
                  destructive
                  onClick={() => void handleDelete(c._id)}
                >
                  {tCommon('actions.delete')}
                </CommentAction>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <section>
      <Text as="h3" variant="label">
        {t('detail.comments')} ({comments.length})
      </Text>

      <ul className="mt-3 flex flex-col gap-4">
        {roots.length === 0 && (
          <li>
            <Text as="p" variant="muted">
              {t('detail.noComments')}
            </Text>
          </li>
        )}
        {roots.map((root) => {
          const replies = repliesByParent.get(root._id) ?? [];
          return (
            <li key={root._id} className="flex flex-col gap-3">
              {renderItem(root, false)}
              {replies.length > 0 && (
                <ul className="border-border ml-8 flex flex-col gap-3 border-l pl-3">
                  {replies.map((reply) => (
                    <li key={reply._id}>{renderItem(reply, true)}</li>
                  ))}
                </ul>
              )}
              {replyTo === root._id && canEdit && (
                <div className="ml-8 flex flex-col gap-2">
                  <MentionTextarea
                    id={`reply-${root._id}`}
                    organizationId={organizationId}
                    projectId={projectId}
                    rows={2}
                    value={replyDraft}
                    onValueChange={setReplyDraft}
                    onKeyDown={onModEnter(() => void submitReply(root._id))}
                    placeholder={t('actions.reply')}
                    autoFocus
                  />
                  <MentionTriggerChips
                    organizationId={organizationId}
                    target={{ taskId }}
                    draft={replyDraft}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={replyDraft.trim().length === 0}
                      onClick={() => void submitReply(root._id)}
                    >
                      {t('actions.reply')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setReplyTo(null)}
                    >
                      {tCommon('actions.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && (
        <div className="mt-4 flex items-start gap-2">
          {currentUser && (
            <AssigneeAvatar
              assigneeType="user"
              assigneeId={currentUser.id}
              name={currentUser.name}
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
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
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={draft.trim().length === 0}
                onClick={() => void submitNew()}
              >
                {t('actions.comment')}
              </Button>
            </div>
          </div>
        </div>
      )}
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
