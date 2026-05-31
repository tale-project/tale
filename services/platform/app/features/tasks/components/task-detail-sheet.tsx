'use client';

import { Button } from '@tale/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useProject } from '@/app/features/projects/hooks/queries';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { formatTaskIdentifier } from '@/lib/shared/project_key';

import {
  useAddTaskComment,
  useClaimTask,
  useUpdateTaskStatus,
} from '../hooks/mutations';
import {
  useSubtasks,
  useTask,
  useTaskActivity,
  useTaskComments,
} from '../hooks/queries';
import { TASK_STATUS_ORDER, type TaskStatus } from '../lib/display';
import { AssigneeAvatar } from './assignee-avatar';
import { TaskPriorityBadge } from './task-priority-badge';
import { TaskStatusBadge } from './task-status-badge';

export function TaskDetailSheet({
  taskId,
  open,
  onOpenChange,
}: {
  taskId: Id<'tasks'> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('tasks');
  const { task, canEdit, canClaim } = useTask(taskId ?? undefined);
  const { project } = useProject(task?.projectId);
  const identifier = formatTaskIdentifier(project?.key, task?.number);
  const { comments } = useTaskComments(taskId ?? undefined);
  const { activity } = useTaskActivity(taskId ?? undefined);
  const { subtasks } = useSubtasks(taskId ?? undefined);

  const updateStatus = useUpdateTaskStatus();
  const addComment = useAddTaskComment();
  const claimTask = useClaimTask();
  const [commentDraft, setCommentDraft] = useState('');

  const statusOptions = TASK_STATUS_ORDER.map((s) => ({
    value: s,
    label: t(`status.${s}`),
  }));

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-2xl">
        {task ? (
          <div className="flex flex-col gap-4">
            <div>
              {identifier && (
                <Text
                  as="span"
                  variant="muted"
                  className="font-mono text-xs tracking-wide"
                >
                  {identifier}
                </Text>
              )}
              <ResponsiveDialogTitle>{task.title}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="sr-only">
                {t('detail.overview')}
              </ResponsiveDialogDescription>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <TaskStatusBadge status={task.status} />
                {task.priority && (
                  <TaskPriorityBadge priority={task.priority} />
                )}
                <AssigneeAvatar
                  assigneeType={task.assigneeType}
                  assigneeId={task.assigneeId}
                  size="md"
                />
                {canClaim && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      taskId && void claimTask.mutateAsync({ taskId })
                    }
                  >
                    {t('actions.claim')}
                  </Button>
                )}
              </div>
            </div>

            {task.description && (
              <Text as="p" variant="body" className="whitespace-pre-wrap">
                {task.description}
              </Text>
            )}

            {canEdit && (
              <Select
                id="detail-status"
                label={t('fields.status')}
                value={task.status}
                options={statusOptions}
                onValueChange={(value: string) =>
                  taskId &&
                  void updateStatus.mutateAsync({
                    taskId,
                    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- options from TASK_STATUS_ORDER
                    status: value as TaskStatus,
                  })
                }
              />
            )}

            {subtasks.length > 0 && (
              <section>
                <Text as="h3" variant="label">
                  {t('detail.subtasks')} ({subtasks.length})
                </Text>
                <ul className="mt-2 flex flex-col gap-1">
                  {subtasks.map((sub) => (
                    <li
                      key={sub._id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <TaskStatusBadge status={sub.status} />
                      <span className="truncate">{sub.title}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <Text as="h3" variant="label">
                {t('detail.comments')} ({comments.length})
              </Text>
              <ul className="mt-2 flex flex-col gap-2">
                {comments.map((comment) => (
                  <li
                    key={comment._id}
                    className="border-border rounded-md border p-2 text-sm"
                  >
                    <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs">
                      <AssigneeAvatar
                        assigneeType={comment.authorType}
                        assigneeId={comment.authorId}
                      />
                      <span>{comment.authorId}</span>
                    </div>
                    <Text as="p" variant="body" className="whitespace-pre-wrap">
                      {comment.body}
                    </Text>
                  </li>
                ))}
              </ul>
              {canEdit && (
                <div className="mt-2 flex flex-col gap-2">
                  <Textarea
                    id="new-comment"
                    rows={2}
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    placeholder={t('actions.comment')}
                  />
                  <Button
                    size="sm"
                    disabled={commentDraft.trim().length === 0}
                    onClick={async () => {
                      if (!taskId) return;
                      await addComment.mutateAsync({
                        taskId,
                        body: commentDraft.trim(),
                      });
                      setCommentDraft('');
                    }}
                  >
                    {t('actions.comment')}
                  </Button>
                </div>
              )}
            </section>

            <section>
              <Text as="h3" variant="label">
                {t('detail.activity')}
              </Text>
              <ul className="text-muted-foreground mt-2 flex flex-col gap-1 text-xs">
                {activity.map((entry) => (
                  <li key={entry._id}>
                    {entry.action}
                    {entry.fromValue || entry.toValue
                      ? `: ${entry.fromValue ?? ''} → ${entry.toValue ?? ''}`
                      : ''}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : (
          <ResponsiveDialogTitle>{t('title')}</ResponsiveDialogTitle>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
