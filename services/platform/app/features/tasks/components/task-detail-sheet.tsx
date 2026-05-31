'use client';

import { Button } from '@tale/ui/button';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

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
import { isTaskStatus, TASK_ACTIVITY_LABEL_KEY } from '../lib/display';
import { subtaskProgress } from '../lib/subtasks';
import { AssigneeAvatar } from './assignee-avatar';
import { AssigneePicker } from './assignee-picker';
import { PriorityPicker } from './priority-picker';
import { StatusPicker } from './status-picker';
import { TaskComments } from './task-comments';
import { TaskDependencies } from './task-dependencies';
import { SubtaskProgress } from './task-indicators';
import { TaskStatusBadge } from './task-status-badge';

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

  const projectKey = project?.key ?? null;
  const assigneeName =
    task?.assigneeType && task.assigneeId
      ? resolveActor(task.assigneeType, task.assigneeId).name
      : t('assignee.unassigned');
  const { done: subtasksDone, total: subtasksTotal } =
    subtaskProgress(subtasks);

  const onMutationError = (error: unknown) => {
    if (
      error instanceof ConvexError &&
      error.data?.code === 'TASK_HAS_OPEN_SUBTASKS'
    ) {
      toast({ title: t('detail.parentCloseGuard'), variant: 'destructive' });
      return;
    }
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
            <dl className="border-border bg-muted/20 flex flex-col gap-1 rounded-lg border p-2">
              <PropertyRow label={t('fields.status')}>
                <StatusPicker
                  status={task.status}
                  disabled={!canEdit}
                  onChange={(status) =>
                    void updateStatus
                      .mutateAsync({ taskId: task._id, status })
                      .catch(onMutationError)
                  }
                />
              </PropertyRow>
              <PropertyRow label={t('fields.priority')}>
                <div className="flex items-center gap-2">
                  <PriorityPicker
                    priority={task.priority ?? null}
                    disabled={!canEdit}
                    onChange={(priority) =>
                      void updateTask
                        .mutateAsync({ taskId: task._id, priority })
                        .catch(onMutationError)
                    }
                  />
                  <Text as="span" variant="body">
                    {task.priority
                      ? t(`priority.${task.priority}`)
                      : t('priority.none')}
                  </Text>
                </div>
              </PropertyRow>
              <PropertyRow label={t('fields.assignee')}>
                <div className="flex items-center gap-2">
                  <AssigneePicker
                    organizationId={task.organizationId}
                    projectId={task.projectId}
                    assigneeType={task.assigneeType}
                    assigneeId={task.assigneeId}
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
                  <Text as="span" variant="body">
                    {assigneeName}
                  </Text>
                </div>
              </PropertyRow>
            </dl>

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

            {/* Dependencies */}
            <TaskDependencies
              task={task}
              canEdit={canEdit}
              projectKey={projectKey}
              onOpenTask={onOpenTask}
            />

            {/* Subtasks */}
            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Text as="h3" variant="label">
                  {t('detail.subtasks')}
                </Text>
                {subtasksTotal > 0 && (
                  <SubtaskProgress done={subtasksDone} total={subtasksTotal} />
                )}
              </div>
              {subtasks.length > 0 && (
                <ul className="border-border divide-border divide-y overflow-hidden rounded-lg border">
                  {subtasks.map((sub) => {
                    const subIdentifier = formatTaskIdentifier(
                      projectKey,
                      sub.number,
                    );
                    const subAssignee =
                      sub.assigneeType && sub.assigneeId
                        ? resolveActor(sub.assigneeType, sub.assigneeId)
                        : null;
                    return (
                      <li key={sub._id}>
                        <button
                          type="button"
                          onClick={() => onOpenTask?.(sub._id)}
                          disabled={!onOpenTask}
                          className={cn(
                            'hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
                            !onOpenTask &&
                              'cursor-default hover:bg-transparent',
                          )}
                        >
                          <TaskStatusBadge status={sub.status} />
                          {subIdentifier && (
                            <Text
                              as="span"
                              variant="caption"
                              className="shrink-0 font-mono text-[11px] tracking-wide"
                            >
                              {subIdentifier}
                            </Text>
                          )}
                          <span
                            className={cn(
                              'flex-1 truncate',
                              sub.status === 'done' &&
                                'text-muted-foreground line-through',
                            )}
                          >
                            {sub.title}
                          </span>
                          {subAssignee && (
                            <AssigneeAvatar
                              assigneeType={subAssignee.type}
                              assigneeId={subAssignee.id}
                              name={subAssignee.name}
                            />
                          )}
                        </button>
                      </li>
                    );
                  })}
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
              <ul className="mt-3 flex flex-col gap-3">
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
                  // A transition shows "from → to"; a single-sided action (a
                  // claim, an added/removed dependency) shows just its value.
                  const detail = from && to ? `${from} → ${to}` : (to ?? from);
                  return (
                    <li key={entry._id} className="flex items-center gap-2">
                      <AssigneeAvatar
                        assigneeType={entry.actorType}
                        assigneeId={entry.actorId}
                        name={actor.name}
                      />
                      <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 text-xs">
                        <span className="text-foreground font-medium">
                          {actor.name}
                        </span>
                        <span>
                          {label.toLowerCase()}
                          {detail ? `: ${detail}` : ''}
                        </span>
                        <span aria-hidden="true">·</span>
                        <time
                          dateTime={new Date(entry.createdAt).toISOString()}
                          title={formatDate(new Date(entry.createdAt), 'long')}
                        >
                          {formatRelative(new Date(entry.createdAt))}
                        </time>
                      </div>
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

/** One labelled row in the task's property panel: a fixed-width caption beside
 *  its control, aligned across rows. */
function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center gap-3 px-1">
      <dt className="text-muted-foreground w-24 shrink-0 text-sm">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
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
