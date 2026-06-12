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
import { useEffect, useState, type ReactNode } from 'react';

import { DatePicker } from '@/app/components/ui/forms/date-picker';
import { Input } from '@/app/components/ui/forms/input';
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
  type TaskActorType,
  type TaskPriority,
  type TaskStatus,
} from '../lib/display';
import { subtaskProgress } from '../lib/subtasks';
import { AssigneeAvatar } from './assignee-avatar';
import { AssigneePicker } from './assignee-picker';
import { LabelEditor } from './label-editor';
import { PriorityPicker } from './priority-picker';
import { StatusPicker } from './status-picker';
import { TaskAgentRuns } from './task-agent-runs';
import { TaskComments } from './task-comments';
import { TaskDependencies } from './task-dependencies';
import { SubtaskProgress } from './task-indicators';
import { TaskReviewCard } from './task-review-card';
import { TaskStatusBadge } from './task-status-badge';

/**
 * The ONE task modal — used for BOTH creating a task and viewing/editing one.
 * `taskId` present → edit mode (live mutations on the loaded task, plus the
 * rich body: dependencies, subtasks, comments, activity); absent → create mode
 * (a local draft committed with a Create button).
 *
 * Layout is Linear-style: a main column (title + description + edit-only body)
 * beside a property panel (Status · Priority · Assignee · Due date / Labels /
 * Author · Created). Dependencies render in the main column where they have the
 * width for their task chips.
 */
export function TaskModal({
  open,
  onOpenChange,
  organizationId,
  projectId,
  taskId,
  defaultStatus,
  onOpenTask,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  projectId: Id<'projects'>;
  /** Present → edit/view an existing task; absent → create a new one. */
  taskId?: Id<'tasks'> | null;
  /** Initial status for create mode (e.g. the "+" of a list section). */
  defaultStatus?: TaskStatus;
  /** Navigate to another task (subtasks / dependency links). */
  onOpenTask?: (taskId: Id<'tasks'>) => void;
}) {
  const { t } = useT('tasks');
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-3xl">
        <ResponsiveDialogDescription className="sr-only">
          {t('detail.overview')}
        </ResponsiveDialogDescription>
        {taskId ? (
          <EditTaskBody taskId={taskId} onOpenTask={onOpenTask} />
        ) : (
          <CreateTaskBody
            organizationId={organizationId}
            projectId={projectId}
            defaultStatus={defaultStatus ?? 'backlog'}
            onClose={() => onOpenChange(false)}
          />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** Two-column shell shared by both modes: main content + right property panel. */
function ModalLayout({
  header,
  main,
  panel,
  footer,
}: {
  header: ReactNode;
  main: ReactNode;
  panel: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {header}
      <div className="flex flex-col gap-6 md:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-5">{main}</div>
        <aside className="flex shrink-0 flex-col gap-4 md:w-60 md:border-l md:pl-6">
          {panel}
        </aside>
      </div>
      {footer}
    </div>
  );
}

/** One property in the side panel: a fixed-width muted label beside its control
 *  (or above it, for controls that wrap, like Labels). */
function PropertyField({
  label,
  children,
  stacked,
}: {
  label: string;
  children: ReactNode;
  stacked?: boolean;
}) {
  if (stacked) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs font-medium">
          {label}
        </span>
        {children}
      </div>
    );
  }
  return (
    <div className="flex min-h-7 items-center gap-2">
      <span className="text-muted-foreground w-20 shrink-0 text-xs font-medium">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A thin divider between property-panel groups. */
function PanelDivider() {
  return <div className="border-border/60 border-t" aria-hidden="true" />;
}

// ───────────────────────────────── Create ─────────────────────────────────

function CreateTaskBody({
  organizationId,
  projectId,
  defaultStatus,
  onClose,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
  defaultStatus: TaskStatus;
  onClose: () => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const createTask = useCreateTask();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [priority, setPriority] = useState<TaskPriority | null>(null);
  const [assignee, setAssignee] = useState<{
    type: TaskActorType;
    id: string;
  } | null>(null);
  const [dueDate, setDueDate] = useState<number | undefined>(undefined);
  const [labels, setLabels] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await createTask.mutateAsync({
        organizationId,
        projectId,
        title: trimmed,
        description: description.trim() || undefined,
        status,
        priority: priority ?? undefined,
        labels: labels.length ? labels : undefined,
        assigneeType: assignee?.type,
        assigneeId: assignee?.id,
        dueDate,
      });
      toast({ title: t('actions.create'), variant: 'success' });
      onClose();
    } catch (error) {
      console.error('Create task error:', error);
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
      setSubmitting(false);
    }
  };

  return (
    <ModalLayout
      header={
        <ResponsiveDialogTitle className="text-lg leading-snug font-semibold">
          {t('actions.create')}
        </ResponsiveDialogTitle>
      }
      main={
        <>
          <Input
            id="task-title"
            label={t('fields.title')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
            autoFocus
            required
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter submits from the title (fast path).
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <Textarea
            id="task-description"
            label={t('fields.description')}
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={submitting}
          />
        </>
      }
      panel={
        <>
          <PropertyField label={t('fields.status')}>
            <StatusPicker status={status} onChange={setStatus} align="end" />
          </PropertyField>
          <PropertyField label={t('fields.priority')}>
            <PriorityPicker
              priority={priority}
              onChange={setPriority}
              align="end"
            />
          </PropertyField>
          <PropertyField label={t('fields.assignee')}>
            <AssigneePicker
              organizationId={organizationId}
              projectId={projectId}
              assigneeType={assignee?.type}
              assigneeId={assignee?.id}
              align="end"
              onAssign={(type, id) => setAssignee({ type, id })}
              onUnassign={() => setAssignee(null)}
            />
          </PropertyField>
          <PropertyField label={t('dueDate.label')}>
            <DatePicker
              value={dueDate}
              onChange={(ms) => setDueDate(ms ?? undefined)}
            />
          </PropertyField>
          <PanelDivider />
          <PropertyField label={t('fields.labels')} stacked>
            <LabelEditor labels={labels} onChange={setLabels} />
          </PropertyField>
        </>
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {tCommon('actions.cancel')}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting || title.trim().length === 0}
          >
            {t('actions.create')}
          </Button>
        </div>
      }
    />
  );
}

// ────────────────────────────────── Edit ──────────────────────────────────

function EditTaskBody({
  taskId,
  onOpenTask,
}: {
  taskId: Id<'tasks'>;
  onOpenTask?: (taskId: Id<'tasks'>) => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { task, canEdit } = useTask(taskId);
  const { project } = useProject(task?.projectId);
  const identifier = formatTaskIdentifier(project?.key, task?.number);
  const projectKey = project?.key ?? null;
  const { activity } = useTaskActivity(taskId);
  const { subtasks } = useSubtasks(taskId);
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

  if (!task) {
    return <ResponsiveDialogTitle>{t('title')}</ResponsiveDialogTitle>;
  }

  const assigneeName =
    task.assigneeType && task.assigneeId
      ? resolveActor(task.assigneeType, task.assigneeId).name
      : t('assignee.unassigned');
  const author = resolveActor(task.createdByType, task.createdBy);
  const { done: subtasksDone, total: subtasksTotal } =
    subtaskProgress(subtasks);

  const addSubtask = async () => {
    const subTitle = subtaskTitle.trim();
    if (!subTitle) return;
    try {
      await createTask.mutateAsync({
        organizationId: task.organizationId,
        projectId: task.projectId,
        title: subTitle,
        status: 'todo',
        parentTaskId: task._id,
      });
      setSubtaskTitle('');
    } catch (error) {
      onMutationError(error);
    }
  };

  return (
    <ModalLayout
      header={
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
      }
      main={
        <>
          <TaskReviewCard taskId={task._id} />
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

          <TaskDependencies
            task={task}
            canEdit={canEdit}
            projectKey={projectKey}
            onOpenTask={onOpenTask}
          />

          <TaskAgentRuns taskId={task._id} />

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
                          !onOpenTask && 'cursor-default hover:bg-transparent',
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
        </>
      }
      panel={
        <>
          <PropertyField label={t('fields.status')}>
            <StatusPicker
              status={task.status}
              disabled={!canEdit}
              align="end"
              onChange={(status) =>
                void updateStatus
                  .mutateAsync({ taskId: task._id, status })
                  .catch(onMutationError)
              }
            />
          </PropertyField>
          <PropertyField label={t('fields.priority')}>
            <PriorityPicker
              priority={task.priority ?? null}
              disabled={!canEdit}
              align="end"
              onChange={(priority) =>
                void updateTask
                  .mutateAsync({ taskId: task._id, priority })
                  .catch(onMutationError)
              }
            />
          </PropertyField>
          <PropertyField label={t('fields.assignee')}>
            <div className="flex min-w-0 items-center gap-1.5">
              <AssigneePicker
                organizationId={task.organizationId}
                projectId={task.projectId}
                assigneeType={task.assigneeType}
                assigneeId={task.assigneeId}
                disabled={!canEdit}
                align="end"
                onAssign={(assigneeType, assigneeId) =>
                  void assignTask
                    .mutateAsync({ taskId: task._id, assigneeType, assigneeId })
                    .catch(onMutationError)
                }
                onUnassign={() =>
                  void assignTask
                    .mutateAsync({ taskId: task._id })
                    .catch(onMutationError)
                }
              />
              <span className="text-foreground min-w-0 truncate text-sm">
                {assigneeName}
              </span>
            </div>
          </PropertyField>
          <PropertyField label={t('dueDate.label')}>
            <DatePicker
              value={task.dueDate}
              disabled={!canEdit}
              onChange={(dueDate) =>
                void updateTask
                  .mutateAsync({ taskId: task._id, dueDate })
                  .catch(onMutationError)
              }
            />
          </PropertyField>

          <PanelDivider />
          <PropertyField label={t('fields.labels')} stacked>
            <LabelEditor
              labels={task.labels ?? []}
              disabled={!canEdit}
              onChange={(labels) =>
                void updateTask
                  .mutateAsync({ taskId: task._id, labels })
                  .catch(onMutationError)
              }
            />
          </PropertyField>

          <PanelDivider />
          <PropertyField label={t('fields.author')}>
            <div className="flex min-w-0 items-center gap-1.5">
              <AssigneeAvatar
                assigneeType={task.createdByType}
                assigneeId={task.createdBy}
                name={author.name}
              />
              <span className="text-foreground min-w-0 truncate text-sm">
                {author.name}
              </span>
            </div>
          </PropertyField>
          <PropertyField label={t('fields.created')}>
            <span className="text-foreground text-sm">
              {formatDate(new Date(task.createdAt), 'medium')}
            </span>
          </PropertyField>
        </>
      }
    />
  );
}

// ───────────────────────── inline-editable helpers ─────────────────────────

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
