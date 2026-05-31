'use client';

import { Button } from '@tale/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Text } from '@tale/ui/text';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useProject } from '@/app/features/projects/hooks/queries';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { formatTaskIdentifier } from '@/lib/shared/project_key';
import { cn } from '@/lib/utils/cn';

import {
  useAssignTask,
  useCreateTask,
  useUpdateTask,
  useUpdateTaskStatus,
} from '../hooks/mutations';
import { useSubtasks, useTask, useTaskActivity } from '../hooks/queries';
import { useActorDirectory } from '../hooks/use-actor-directory';
import {
  isTaskStatus,
  TASK_ACTIVITY_LABEL_KEY,
  TASK_PRIORITY_ORDER,
  TASK_STATUS_ORDER,
  type TaskPriority,
} from '../lib/display';
import { AssigneePicker } from './assignee-picker';
import { TaskComments } from './task-comments';
import { TaskPriorityIcon } from './task-priority-icon';
import { TaskStatusBadge } from './task-status-badge';

const NO_PRIORITY = 'none';

export function TaskDetailSheet({
  taskId,
  open,
  onOpenChange,
  onOpenTask,
}: {
  taskId: Id<'tasks'> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open another task (used to navigate into a subtask). */
  onOpenTask?: (taskId: Id<'tasks'>) => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { task, canEdit } = useTask(taskId ?? undefined);
  const { project } = useProject(task?.projectId);
  const identifier = formatTaskIdentifier(project?.key, task?.number);
  const { activity } = useTaskActivity(taskId ?? undefined);
  const { subtasks } = useSubtasks(taskId ?? undefined);
  const { data: me } = useCurrentMemberContext(task?.organizationId);
  const { resolveActor } = useActorDirectory(
    task?.organizationId ?? '',
    task?.projectId,
  );
  const { formatRelative, formatDate } = useFormatDate();

  const updateTask = useUpdateTask();
  const updateStatus = useUpdateTaskStatus();
  const assignTask = useAssignTask();
  const createTask = useCreateTask();

  const [subtaskTitle, setSubtaskTitle] = useState('');

  const statusOptions = useMemo(
    () => TASK_STATUS_ORDER.map((s) => ({ value: s, label: t(`status.${s}`) })),
    [t],
  );
  const priorityOptions = useMemo(
    () => [
      { value: NO_PRIORITY, label: '—' },
      ...TASK_PRIORITY_ORDER.map((p) => ({
        value: p,
        label: t(`priority.${p}`),
      })),
    ],
    [t],
  );

  const onMutationError = (error: unknown) => {
    console.error('[tasks] detail action failed', error);
    toast({ title: tCommon('errors.generic'), variant: 'destructive' });
  };

  const addSubtask = async () => {
    const title = subtaskTitle.trim();
    if (!title || !task) return;
    try {
      await createTask.mutateAsync({
        organizationId: task.organizationId,
        projectId: task.projectId,
        title,
        status: 'todo',
        parentTaskId: task._id,
      });
      setSubtaskTitle('');
    } catch (error) {
      onMutationError(error);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-2xl">
        {task ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              {identifier && (
                <Text
                  as="span"
                  variant="muted"
                  className="font-mono text-xs tracking-wide"
                >
                  {identifier}
                </Text>
              )}
              <ResponsiveDialogTitle className="sr-only">
                {task.title}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="sr-only">
                {t('detail.overview')}
              </ResponsiveDialogDescription>

              {canEdit ? (
                <EditableTitle
                  key={task._id}
                  value={task.title}
                  ariaLabel={t('fields.title')}
                  onSave={(title) =>
                    void updateTask
                      .mutateAsync({ taskId: task._id, title })
                      .catch(onMutationError)
                  }
                />
              ) : (
                <h2 className="text-foreground text-lg leading-snug font-semibold">
                  {task.title}
                </h2>
              )}
            </div>

            {/* Properties */}
            <div className="flex flex-col gap-3">
              {canEdit ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Select
                    id="detail-status"
                    label={t('fields.status')}
                    value={task.status}
                    options={statusOptions}
                    onValueChange={(value: string) => {
                      if (!isTaskStatus(value)) return;
                      void updateStatus
                        .mutateAsync({ taskId: task._id, status: value })
                        .catch(onMutationError);
                    }}
                  />
                  <Select
                    id="detail-priority"
                    label={t('fields.priority')}
                    value={task.priority ?? NO_PRIORITY}
                    options={priorityOptions}
                    onValueChange={(value: string) => {
                      const priority =
                        value === NO_PRIORITY
                          ? null
                          : // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- options derived from TASK_PRIORITY_ORDER
                            (value as TaskPriority);
                      void updateTask
                        .mutateAsync({ taskId: task._id, priority })
                        .catch(onMutationError);
                    }}
                  />
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <TaskStatusBadge status={task.status} />
                  {task.priority && (
                    <TaskPriorityIcon priority={task.priority} showLabel />
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Text as="span" variant="caption" className="w-20 shrink-0">
                  {t('fields.assignee')}
                </Text>
                <AssigneePicker
                  organizationId={task.organizationId}
                  projectId={task.projectId}
                  assigneeType={task.assigneeType}
                  assigneeId={task.assigneeId}
                  size="md"
                  disabled={!canEdit}
                  onAssign={(assigneeType, assigneeId) =>
                    void assignTask
                      .mutateAsync({
                        taskId: task._id,
                        assigneeType,
                        assigneeId,
                      })
                      .catch(onMutationError)
                  }
                  onUnassign={() =>
                    void assignTask
                      .mutateAsync({ taskId: task._id })
                      .catch(onMutationError)
                  }
                />
              </div>
            </div>

            {/* Description */}
            <section className="flex flex-col gap-1.5">
              <Text as="h3" variant="label">
                {t('fields.description')}
              </Text>
              {canEdit ? (
                <EditableDescription
                  key={task._id}
                  value={task.description ?? ''}
                  placeholder={t('detail.addDescription')}
                  onSave={(description) =>
                    void updateTask
                      .mutateAsync({
                        taskId: task._id,
                        description: description.length ? description : null,
                      })
                      .catch(onMutationError)
                  }
                />
              ) : task.description ? (
                <Text as="p" variant="body" className="whitespace-pre-wrap">
                  {task.description}
                </Text>
              ) : (
                <Text as="p" variant="muted">
                  {t('detail.noDescription')}
                </Text>
              )}
            </section>

            {/* Subtasks */}
            <section className="flex flex-col gap-2">
              <Text as="h3" variant="label">
                {t('detail.subtasks')} ({subtasks.length})
              </Text>
              {subtasks.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {subtasks.map((sub) => (
                    <li key={sub._id}>
                      <button
                        type="button"
                        onClick={() => onOpenTask?.(sub._id)}
                        disabled={!onOpenTask}
                        className={cn(
                          'hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
                          !onOpenTask && 'cursor-default hover:bg-transparent',
                        )}
                      >
                        <TaskStatusBadge status={sub.status} />
                        <span className="truncate">{sub.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <div className="flex items-center gap-2">
                  <Textarea
                    id="new-subtask"
                    rows={1}
                    value={subtaskTitle}
                    onChange={(e) => setSubtaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void addSubtask();
                      }
                    }}
                    placeholder={t('detail.addSubtask')}
                    className="min-h-0"
                  />
                  <Button
                    size="sm"
                    icon={Plus}
                    variant="secondary"
                    disabled={subtaskTitle.trim().length === 0}
                    onClick={() => void addSubtask()}
                  >
                    {t('actions.add')}
                  </Button>
                </div>
              )}
            </section>

            <TaskComments
              taskId={task._id}
              organizationId={task.organizationId}
              projectId={task.projectId}
              canEdit={canEdit}
              currentUserId={me?.userId}
              isAdmin={me?.isAdmin}
            />

            {/* Activity */}
            <section>
              <Text as="h3" variant="label">
                {t('detail.activity')}
              </Text>
              <ul className="text-muted-foreground mt-2 flex flex-col gap-1.5 text-xs">
                {activity.map((entry) => {
                  const labelKey = TASK_ACTIVITY_LABEL_KEY[entry.action];
                  const label = labelKey ? t(labelKey) : entry.action;
                  const actor = resolveActor(entry.actorType, entry.actorId);
                  const from =
                    entry.fromValue && isTaskStatus(entry.fromValue)
                      ? t(`status.${entry.fromValue}`)
                      : entry.fromValue;
                  const to =
                    entry.toValue && isTaskStatus(entry.toValue)
                      ? t(`status.${entry.toValue}`)
                      : entry.toValue;
                  return (
                    <li key={entry._id} className="flex flex-wrap gap-x-1">
                      <span className="text-foreground font-medium">
                        {actor.name}
                      </span>
                      <span>
                        {label.toLowerCase()}
                        {from || to ? `: ${from ?? ''} → ${to ?? ''}` : ''}
                      </span>
                      <span aria-hidden="true">·</span>
                      <time
                        dateTime={new Date(entry.createdAt).toISOString()}
                        title={formatDate(new Date(entry.createdAt), 'long')}
                      >
                        {formatRelative(new Date(entry.createdAt))}
                      </time>
                    </li>
                  );
                })}
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

/** Inline-editable single-line title; commits on blur / Enter, reverts on Escape. */
function EditableTitle({
  value,
  ariaLabel,
  onSave,
}: {
  value: string;
  ariaLabel: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    else setDraft(value);
  };

  return (
    <input
      value={draft}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className="text-foreground hover:bg-muted/50 focus:bg-muted/50 -mx-1 rounded-md px-1 text-lg leading-snug font-semibold outline-none"
    />
  );
}

/** Inline-editable description; commits on blur when changed. */
function EditableDescription({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <Textarea
      id="detail-description"
      rows={3}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() !== value.trim()) onSave(draft.trim());
      }}
    />
  );
}
