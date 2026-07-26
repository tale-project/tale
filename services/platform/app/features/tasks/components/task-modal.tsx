'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { Archive, ArchiveRestore, Plus } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { DatePicker } from '@/app/components/ui/forms/date-picker';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useProject } from '@/app/features/projects/hooks/queries';
import {
  type FileAttachment,
  useConvexFileUpload,
} from '@/app/features/shared/files/use-convex-file-upload';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { TASK_TITLE_MAX } from '@/convex/tasks/helpers';
import { useT } from '@/lib/i18n/client';
import { TASK_UPLOAD_ALLOWED_TYPES } from '@/lib/shared/file-types';
import { formatTaskIdentifier } from '@/lib/shared/project_key';
import { cn } from '@/lib/utils/cn';

import {
  useAssignTask,
  useCreateTask,
  useUpdateTask,
  useUpdateTaskStatus,
} from '../hooks/mutations';
import { useSubtasks, useTask } from '../hooks/queries';
import { useActorDirectory } from '../hooks/use-actor-directory';
import {
  type TaskActorType,
  type TaskPriority,
  type TaskStatus,
} from '../lib/display';
import { subtaskProgress } from '../lib/subtasks';
import { AssigneeAvatar } from './assignee-avatar';
import { AssigneePicker } from './assignee-picker';
import { LabelEditor } from './label-editor';
import { MentionText } from './mention-text';
import { MentionTextarea } from './mention-textarea';
import { MentionTriggerChips } from './mention-trigger-chips';
import { PriorityPicker } from './priority-picker';
import { StatusPicker } from './status-picker';
import { TaskArchiveDialog } from './task-archive-dialog';
import { TaskArchivedBadge } from './task-archived-badge';
import { TaskAttachments } from './task-attachments';
import { TaskComments } from './task-comments';
import { TaskDependencies } from './task-dependencies';
import { SubtaskProgress } from './task-indicators';
import { TaskReviewCard } from './task-review-card';
import { TaskRunFailureBanner } from './task-run-failure-banner';
import { TaskStartAutomation } from './task-start-automation';
import { TaskStatusBadge } from './task-status-badge';
import { TaskTimeline } from './task-timeline';

/** Strip the client-only `previewUrl` so the value matches the mutations'
 *  strict `attachments` validator. Always an array (an empty array sent to
 *  `updateTask` CLEARS the field — `undefined` would mean "leave untouched"). */
function stripPreviews(attachments: FileAttachment[]) {
  return attachments.map(({ fileId, fileName, fileType, fileSize }) => ({
    fileId,
    fileName,
    fileType,
    fileSize,
  }));
}

/**
 * The ONE task modal — used for BOTH creating a task and viewing/editing one.
 * `taskId` present → edit mode (live mutations on the loaded task, plus the
 * rich body: dependencies, subtasks, comments, activity); absent → create mode
 * (a local draft committed with a Create button).
 *
 * Layout is Linear-style: a main column (title + description + edit-only body)
 * beside a property panel (Status · Priority · Assignee · Due date / Labels /
 * Dependencies / Author · Created). In edit mode the dialog has a FIXED height
 * and each column scrolls on its own, so the modal never resizes as content
 * (comments, activity, agent runs) streams in.
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
      <ResponsiveDialogContent
        className={cn(
          'max-w-3xl',
          // Edit mode: pin the dialog height so it never jumps as comments /
          // activity / agent runs load; the columns scroll internally instead.
          taskId && 'flex h-[85dvh] flex-col overflow-hidden',
        )}
        // Edit mode: Radix would focus (and text-select) the first tabbable —
        // the inline-editable title. Keep focus on the dialog instead; create
        // mode keeps its intentional title autofocus.
        onOpenAutoFocus={taskId ? (e) => e.preventDefault() : undefined}
      >
        <ResponsiveDialogDescription className="sr-only">
          {t('detail.overview')}
        </ResponsiveDialogDescription>
        {taskId ? (
          <EditTaskBody
            taskId={taskId}
            onOpenTask={onOpenTask}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <CreateTaskBody
            organizationId={organizationId}
            projectId={projectId}
            // Board creates default to `todo` so new tasks land in a visible lane.
            defaultStatus={defaultStatus ?? 'todo'}
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
    <Stack className="min-h-0 flex-1">
      <div className="shrink-0">{header}</div>
      {/* Inside the fixed-height edit dialog each column owns its scroll; in
          the auto-height create dialog these min-h/overflow rules are inert.
          The column gutter is the main column's PADDING (md:pr-6), not a row
          gap — padding lives inside the scrollport, so the main scrollbar
          renders flush against the panel divider instead of floating
          mid-gutter. The negative-margin + padding pair on the left widens
          the scrollport slightly so focus rings on full-width fields aren't
          clipped at the column edge. */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 md:flex-row md:gap-0">
        <Stack
          gap={5}
          className="min-w-0 flex-1 md:-ml-2 md:min-h-0 md:overflow-y-auto md:py-0.5 md:pr-6 md:pl-2"
        >
          {main}
        </Stack>
        <Stack
          as="aside"
          className="shrink-0 md:-mr-2 md:min-h-0 md:w-[15.5rem] md:overflow-y-auto md:border-l md:py-0.5 md:pr-2 md:pl-6"
        >
          {panel}
        </Stack>
      </div>
      {footer && <div className="shrink-0">{footer}</div>}
    </Stack>
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
    <Row gap={2} align="start" className="min-h-7 shrink-0">
      <span className="text-muted-foreground w-20 shrink-0 pt-1 text-xs font-medium">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </Row>
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
  const { attachments, uploadingFiles, uploadFiles, removeAttachment } =
    useConvexFileUpload({
      organizationId,
      allowedTypes: [...TASK_UPLOAD_ALLOWED_TYPES],
    });

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
        attachments: attachments.length
          ? stripPreviews(attachments)
          : undefined,
        status,
        priority: priority ?? undefined,
        labels: labels.length ? labels : undefined,
        assigneeType: assignee?.type,
        assigneeId: assignee?.id,
        dueDate,
      });
      toast({ title: t('actions.created'), variant: 'success' });
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
            // Hard-cap at the server limit (validateTitle rejects > TASK_TITLE_MAX)
            // so an over-long title can't reach the mutation and strand the dialog
            // behind a generic error toast.
            maxLength={TASK_TITLE_MAX}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter submits from the title (fast path).
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <MentionTextarea
            id="task-description"
            organizationId={organizationId}
            projectId={projectId}
            label={t('fields.description')}
            rows={8}
            value={description}
            onValueChange={setDescription}
            disabled={submitting}
            placement="below"
          />
          <MentionTriggerChips
            organizationId={organizationId}
            target={{ projectId }}
            draft={description}
          />
          <TaskAttachments
            attachments={attachments}
            uploadingFiles={uploadingFiles}
            canEdit
            disabled={submitting}
            organizationId={organizationId}
            onUpload={(files) => void uploadFiles(files)}
            onRemove={removeAttachment}
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
              taskTitle={title}
              taskDescription={description}
              taskLabels={labels}
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
            <LabelEditor
              labels={labels}
              onChange={setLabels}
              projectId={projectId}
            />
          </PropertyField>
        </>
      }
      footer={
        <Row gap={2} justify="end">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {tCommon('actions.cancel')}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting || title.trim().length === 0}
          >
            {t('actions.create')}
          </Button>
        </Row>
      }
    />
  );
}

// ────────────────────────────────── Edit ──────────────────────────────────

function EditTaskBody({
  taskId,
  onOpenTask,
  onClose,
}: {
  taskId: Id<'tasks'>;
  onOpenTask?: (taskId: Id<'tasks'>) => void;
  onClose: () => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { task, canEdit, canComment } = useTask(taskId);
  const { project } = useProject(task?.projectId);
  const identifier = formatTaskIdentifier(project?.key, task?.number);
  const projectKey = project?.key ?? null;
  const { subtasks } = useSubtasks(taskId);
  const { data: me } = useCurrentMemberContext(task?.organizationId);
  const { resolveActor } = useActorDirectory(
    task?.organizationId ?? '',
    task?.projectId,
  );
  const { formatDate } = useFormatDate();

  const updateTask = useUpdateTask();
  const updateStatus = useUpdateTaskStatus();
  const assignTask = useAssignTask();
  const createTask = useCreateTask();
  const { uploadingFiles, uploadFiles, clearAttachments } = useConvexFileUpload(
    {
      organizationId: task?.organizationId ?? '',
      allowedTypes: [...TASK_UPLOAD_ALLOWED_TYPES],
    },
  );

  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);

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

  const isArchived = task.archivedAt != null;
  const canMutate = canEdit && !isArchived;

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

  // Upload then persist atomically: uploadFiles awaits every upload, then
  // clearAttachments() returns + resets them, so we fold the new files into the
  // task's existing set in a single updateTask (full-replace, like labels).
  const onUploadAttachments = async (files: File[]) => {
    await uploadFiles(files);
    const added = clearAttachments();
    if (added.length === 0) return;
    await updateTask
      .mutateAsync({
        taskId: task._id,
        attachments: stripPreviews([...(task.attachments ?? []), ...added]),
      })
      .catch(onMutationError);
  };
  const onRemoveAttachment = (fileId: string) => {
    void updateTask
      .mutateAsync({
        taskId: task._id,
        attachments: stripPreviews(
          (task.attachments ?? []).filter((a) => a.fileId !== fileId),
        ),
      })
      .catch(onMutationError);
  };

  return (
    <>
      <ModalLayout
        header={
          <Stack gap={2}>
            {identifier && (
              <Text
                as="span"
                variant="muted"
                className="font-mono text-xs tracking-wide"
              >
                {identifier}
              </Text>
            )}
            {isArchived && <TaskArchivedBadge />}
            <ResponsiveDialogTitle className="sr-only">
              {task.title}
            </ResponsiveDialogTitle>
            {canMutate ? (
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
          </Stack>
        }
        main={
          <>
            <TaskRunFailureBanner
              taskId={task._id}
              organizationId={task.organizationId}
              projectId={task.projectId}
            />
            <TaskReviewCard taskId={task._id} />
            <section className="flex flex-col gap-1.5">
              <Text as="h3" variant="label">
                {t('fields.description')}
              </Text>
              {canMutate ? (
                <EditableDescription
                  key={task._id}
                  taskId={task._id}
                  organizationId={task.organizationId}
                  projectId={task.projectId}
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
                <MentionText
                  body={task.description}
                  organizationId={task.organizationId}
                  projectId={task.projectId}
                />
              ) : (
                <Text as="p" variant="muted">
                  {t('detail.noDescription')}
                </Text>
              )}
            </section>

            <TaskAttachments
              attachments={task.attachments ?? []}
              uploadingFiles={uploadingFiles}
              canEdit={canMutate}
              organizationId={task.organizationId}
              onUpload={onUploadAttachments}
              onRemove={onRemoveAttachment}
            />

            <Stack as="section" gap={2}>
              <Row gap={2}>
                <Text as="h3" variant="label">
                  {t('detail.subtasks')}
                </Text>
                {subtasksTotal > 0 && (
                  <SubtaskProgress done={subtasksDone} total={subtasksTotal} />
                )}
              </Row>
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
              {canMutate && (
                <Row gap={2}>
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
                    icon={Plus}
                    variant="secondary"
                    disabled={subtaskTitle.trim().length === 0}
                    onClick={() => void addSubtask()}
                  >
                    {t('actions.add')}
                  </Button>
                </Row>
              )}
            </Stack>

            <TaskComments
              taskId={task._id}
              organizationId={task.organizationId}
              projectId={task.projectId}
              canComment={canComment}
              currentUserId={me?.userId}
              isAdmin={me?.isAdmin}
            />

            <TaskTimeline
              taskId={task._id}
              organizationId={task.organizationId}
              projectId={task.projectId}
            />
          </>
        }
        panel={
          <>
            <PropertyField label={t('fields.status')}>
              <StatusPicker
                status={task.status}
                disabled={!canMutate}
                align="end"
                onChange={(status) =>
                  void updateStatus
                    .mutateAsync({ taskId: task._id, status })
                    .catch(onMutationError)
                }
              />
            </PropertyField>
            <TaskStartAutomation
              organizationId={task.organizationId}
              projectId={task.projectId}
              taskId={task._id}
              disabled={!canMutate}
            />
            <PropertyField label={t('fields.priority')}>
              <PriorityPicker
                priority={task.priority ?? null}
                disabled={!canMutate}
                align="end"
                onChange={(priority) =>
                  void updateTask
                    .mutateAsync({ taskId: task._id, priority })
                    .catch(onMutationError)
                }
              />
            </PropertyField>
            <PropertyField label={t('fields.assignee')}>
              <AssigneePicker
                organizationId={task.organizationId}
                projectId={task.projectId}
                assigneeType={task.assigneeType}
                assigneeId={task.assigneeId}
                taskTitle={task.title}
                taskDescription={task.description}
                taskLabels={task.labels}
                disabled={!canMutate}
                align="end"
                afterTrigger={
                  <span className="text-foreground min-w-0 truncate text-sm">
                    {assigneeName}
                  </span>
                }
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
            </PropertyField>
            <PropertyField label={t('dueDate.label')}>
              <DatePicker
                value={task.dueDate}
                disabled={!canMutate}
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
                disabled={!canMutate}
                projectId={task.projectId}
                onChange={(labels) =>
                  void updateTask
                    .mutateAsync({ taskId: task._id, labels })
                    .catch(onMutationError)
                }
              />
            </PropertyField>

            <PanelDivider />
            <TaskDependencies
              task={task}
              canEdit={canMutate}
              projectKey={projectKey}
              onOpenTask={onOpenTask}
            />

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
            {canEdit && (
              <>
                <PanelDivider />
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  icon={isArchived ? ArchiveRestore : Archive}
                  onClick={() => setArchiveOpen(true)}
                >
                  {isArchived ? t('actions.restore') : t('actions.archive')}
                </Button>
              </>
            )}
          </>
        }
      />
      <TaskArchiveDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        taskId={task._id}
        taskTitle={task.title}
        isArchived={isArchived}
        onArchived={onClose}
      />
    </>
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

/** Inline-editable description with an explicit Save / Discard pair that
 *  appears while the draft is dirty (⌘/Ctrl+Enter saves, Escape discards).
 *  New @mentions in the draft preview their agent-trigger effect
 *  (`MentionTriggerChips`). */
function EditableDescription({
  taskId,
  organizationId,
  projectId,
  value,
  placeholder,
  onSave,
}: {
  taskId: Id<'tasks'>;
  organizationId: string;
  projectId: Id<'projects'>;
  value: string;
  placeholder: string;
  onSave: (value: string) => void;
}) {
  const { t: tCommon } = useT('common');
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  // Explicit commit instead of save-on-blur: a blur-save would fire on any
  // click-away (incl. reaching for Discard) and silently persist half-edited
  // text. The buttons appear only while the draft differs from the saved
  // value and vanish once the server echoes the update back into `value`.
  const isDirty = draft.trim() !== value.trim();
  const save = () => {
    if (isDirty) onSave(draft.trim());
  };
  const discard = () => setDraft(value);

  return (
    <>
      <MentionTextarea
        id="detail-description"
        organizationId={organizationId}
        projectId={projectId}
        rows={6}
        value={draft}
        placeholder={placeholder}
        onValueChange={setDraft}
        onKeyDown={(e) => {
          // ⌘/Ctrl+Enter saves, Escape discards (the mention picker consumes
          // both first while it is open).
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape' && isDirty) {
            e.preventDefault();
            discard();
          }
        }}
        placement="below"
      />
      <MentionTriggerChips
        organizationId={organizationId}
        target={{ taskId }}
        draft={draft}
        baseline={value}
      />
      {isDirty && (
        <Row gap={2} align="stretch">
          <Button onClick={save}>{tCommon('actions.save')}</Button>
          <Button variant="secondary" onClick={discard}>
            {tCommon('actions.discard')}
          </Button>
        </Row>
      )}
    </>
  );
}
