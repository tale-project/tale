'use client';

import {
  isFieldsForm,
  resolveSettingsFolder,
  settingsFormSatisfied,
} from '@tale/shared/schemas/automation-settings';
import { formatTaskIdentifier } from '@tale/shared/utils/project-key';
import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { DatePicker } from '@tale/ui/date-picker';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { IconButton } from '@tale/ui/icon-button';
import { Input } from '@tale/ui/input';
import { Row, Stack } from '@tale/ui/layout';
import {
  PropertyDivider,
  PropertyList,
  PropertyRow,
} from '@tale/ui/property-list';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Switch } from '@tale/ui/switch';
import { Text } from '@tale/ui/text';
import { useCopy } from '@tale/ui/use-copy';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useImeComposition } from '@tale/ui/use-ime-composition';
import { useIsMac } from '@tale/ui/use-is-mac';
import { toast } from '@tale/ui/use-toast';
import { Link } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  Play,
  Plus,
  Settings2,
  Trash2,
  Workflow,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactNode,
} from 'react';

import { AutomationSettingsDialog } from '@/app/features/automations/components/automation-settings-dialog';
import { AutomationSettingsForm } from '@/app/features/automations/components/automation-settings-form';
import { useAutomationSettingsValues } from '@/app/features/automations/hooks/use-settings-values';
import { useProject } from '@/app/features/projects/hooks/queries';
import { extractPastedImageFiles } from '@/app/features/shared/files/clipboard-images';
import {
  type FileAttachment,
  useFileUpload,
} from '@/app/features/shared/files/use-file-upload';
import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendClient } from '@/app/hooks/use-backend-client';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { failureDetail } from '@/app/lib/backend/adapters';
import { TASK_TITLE_MAX } from '@/backend/core/tasks/helpers';
import { descriptionMentionMode } from '@/backend/core/tasks/mentions';
import { useT } from '@/lib/i18n/client';
import { AppError } from '@/lib/shared/errors/app-error';
import { TASK_UPLOAD_ALLOWED_TYPES } from '@/lib/shared/file-types';
import type { TaskRepeat } from '@/lib/shared/task-repeat';

import {
  useAssignTask,
  useCreateTask,
  useUpdateTask,
  useUpdateTaskStatus,
} from '../hooks/mutations';
import { usePrefetchTaskReads, useSubtasks, useTask } from '../hooks/queries';
import { ActorDirectoryProvider } from '../hooks/task-actor-directory';
import { useActorDirectory } from '../hooks/use-actor-directory';
import { useDescriptionCap } from '../hooks/use-description-cap';
import { useTaskAccess } from '../hooks/use-task-access';
import {
  plannedTransitionKind,
  useTaskStatusChoreography,
} from '../hooks/use-task-status-choreography';
import {
  useTaskSubjectContract,
  useTaskSubjectTemplates,
  type ResolvedTaskSubjectContract,
} from '../hooks/use-task-subject-contract';
import {
  DEFAULT_NEW_TASK_PRIORITY,
  defaultNewTaskStartDate,
} from '../lib/create-defaults';
import {
  TASK_TERMINAL_STATUSES,
  type TaskActorType,
  type TaskPriority,
  type TaskStatus,
} from '../lib/display';
import { parentCloseRefusal } from '../lib/parent-close-refusal';
import { reviewPolicyErrorMessage } from '../lib/review-policy-error';
import { reviewerRefusalMessage } from '../lib/reviewer-refusal';
import { subtaskProgress } from '../lib/subtasks';
import { toastTaskCreated } from '../lib/task-created-toast';
import { taskLimitRefusalMessage } from '../lib/task-limit-refusal';
import {
  canTaskRepeat,
  taskAutomationOwned,
  taskRepeatFieldState,
} from '../lib/task-repeat-edit';
import { taskRunErrorMessage } from '../lib/task-run-error';
import { AssigneeAvatar } from './assignee-avatar';
import { AssigneePicker } from './assignee-picker';
import { EditableDescription } from './editable-description';
import { LabelEditor } from './label-editor';
import { LabelManageDialog } from './label-manage-dialog';
import { MentionText } from './mention-text';
import { MentionTextarea } from './mention-textarea';
import { MentionTriggerChips } from './mention-trigger-chips';
import { PriorityPicker } from './priority-picker';
import { useRunCancelConfirm } from './run-cancel-confirm';
import { StatusPicker } from './status-picker';
import { TaskAgentRunEntry } from './task-agent-run-entry';
import { TaskAgentRunFailureNotice } from './task-agent-run-failure-notice';
import { TaskArchiveDialog } from './task-archive-dialog';
import { TaskAttachments } from './task-attachments';
import { TaskAutomationBadge } from './task-automation-badge';
import { TaskAutomationRunEntry } from './task-automation-run-entry';
import {
  TaskCommentComposer,
  TaskCommentComposerSkeleton,
} from './task-comments';
import { TaskConversation } from './task-conversation';
import { TaskDeleteDialog } from './task-delete-dialog';
import { TaskDependencies } from './task-dependencies';
import { TaskDetailFallback } from './task-detail-fallback';
import { TaskExternalIssueCard } from './task-external-issue-card';
import { TaskExternalStatusCard } from './task-external-status-card';
import { TaskDialogHeaderActions } from './task-header-actions';
import { SubtaskProgress } from './task-indicators';
import { TaskInputFilesCard } from './task-input-files';
import { TaskMetaLine } from './task-meta-line';
import { TaskOutcomeFilesCard } from './task-outcome-files';
import { TaskPageLayout } from './task-page-layout';
import { TaskParentLink } from './task-parent-link';
import { TaskRepeatField } from './task-repeat-field';
import { TaskRepeatNextLink } from './task-repeat-next-link';
import { TaskRepeatStopButton } from './task-repeat-stop-button';
import { TaskReviewerField } from './task-reviewer-field';
import {
  TaskRunFailureBanner,
  useLatestRunRefusal,
} from './task-run-failure-banner';
import { TaskStatusBadge } from './task-status-badge';
import { TaskStatusGlyph } from './task-status-glyph';
import { TaskSubjectPanel } from './task-subject-panel';
import { TaskThreadColumn } from './task-thread-column';
import { formatCents, useTaskTimeline } from './task-timeline';
import { TaskWatchControl } from './task-watch-control';

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

/** What a create starts with instead of a blank form (see `TaskModal`). */
export interface TaskDraft {
  title: string;
  description: string;
  /** Files already uploaded by the person creating the task. */
  attachments: readonly {
    fileId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
  }[];
  /** Who takes it, picked for the person when the choice is obvious (the
   * project's one agent). */
  assignee?: { type: TaskActorType; id: string };
  /** The conversation the task is handed over from — its root thread; the
   * chat then shows the task (`tasks.source_thread_id`). */
  sourceThreadId?: string;
  /** The hand-over's main verb starts the agent: work handed over from a
   * chat is meant to begin, while the board keeps Create as its verb. */
  startAgent?: boolean;
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
  draft,
  onTaskCreated,
  onOpenTask,
  showProjectLink = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  projectId: string;
  /** Present → edit/view an existing task; absent → create a new one. Read
   *  while open: a closing dialog keeps the body it was open with. */
  taskId?: string | null;
  /** Initial status for create mode (e.g. the "+" of a list section). */
  defaultStatus?: TaskStatus;
  /** What create mode starts with instead of a blank form — a task drafted
   * from a chat. Read once, when the form mounts. */
  draft?: TaskDraft;
  /** Create mode: the caller reports the created task itself (with a way to
   * open it) in place of the plain "Task created" toast. */
  onTaskCreated?: (taskId: string) => void;
  /** Navigate to another task (subtasks / dependency links). */
  onOpenTask?: (taskId: string) => void;
  /** All-projects board: show a link to the task's project in the detail. */
  showProjectLink?: boolean;
}) {
  const { t } = useT('tasks');
  const contentRef = useRef<HTMLDivElement>(null);
  // The dialog plays its exit animation with the body it had while open. The
  // board clears `taskId` in the same render that closes it, so a body read
  // off the prop turned the closing task into the empty create form, at the
  // create form's height, and mounted that form's reads on every close
  // (#3939) — render-time state adjustment, no effect.
  const [openTaskId, setOpenTaskId] = useState(taskId);
  if (open && taskId !== openTaskId) setOpenTaskId(taskId);
  const bodyTaskId = open ? taskId : openTaskId;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        ref={contentRef}
        className={cn(
          // Edit mode: wider, for a reading column beside the property panel,
          // and of a pinned height so it never jumps as comments / activity /
          // agent runs load; the columns scroll internally instead.
          bodyTaskId
            ? 'flex h-[85dvh] max-w-5xl flex-col overflow-hidden'
            : 'max-w-3xl',
        )}
        headerActions={
          bodyTaskId ? (
            <TaskDialogHeaderActions
              organizationId={organizationId}
              taskId={bodyTaskId}
            />
          ) : undefined
        }
        // Edit mode: Radix would focus (and text-select) the first tabbable —
        // the inline-editable title. Focus the dialog explicitly: cancelling
        // alone also skips Radix's container fallback and leaves the opener
        // focused behind the overlay. Create mode keeps its title autofocus.
        onOpenAutoFocus={
          bodyTaskId
            ? (event) => {
                event.preventDefault();
                contentRef.current?.focus({ preventScroll: true });
              }
            : undefined
        }
      >
        <ResponsiveDialogDescription className="sr-only">
          {t('detail.overview')}
        </ResponsiveDialogDescription>
        {bodyTaskId ? (
          <EditTaskBody
            // One body per task, as on the task page: a switch through a
            // subtask, parent, dependency or next-task link opens the next
            // task fresh, on its newest message, with nothing sliding in.
            key={bodyTaskId}
            taskId={bodyTaskId}
            active={open}
            onOpenTask={onOpenTask}
            onClose={() => onOpenChange(false)}
            showProjectLink={showProjectLink}
          />
        ) : (
          <CreateTaskBody
            organizationId={organizationId}
            projectId={projectId}
            // Board creates default to `todo` so new tasks land in a visible lane.
            defaultStatus={defaultStatus ?? 'todo'}
            draft={draft}
            onClose={() => onOpenChange(false)}
            onCreated={onOpenTask}
            onTaskCreated={onTaskCreated}
          />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** Two-column shell shared by both modes: main content + right property
 *  panel. An open task's main column is its reading thread — the same column
 *  as its page; the create form's is a plain scrolling column. */
function ModalLayout({
  header,
  main,
  thread,
  panel,
  footer,
}: {
  header: ReactNode;
  panel: ReactNode;
  footer?: ReactNode;
} & (
  | { main: ReactNode; thread?: undefined }
  | {
      main?: undefined;
      thread: {
        brief: ReactNode;
        conversation: ReactNode;
        composer: ReactNode;
      };
    }
)) {
  const { t } = useT('tasks');
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
        {thread !== undefined ? (
          // On a phone the drawer scrolls the whole dialog as one column, so
          // the thread hands its scrolling up and its composer follows it.
          <TaskThreadColumn
            brief={thread.brief}
            conversation={thread.conversation}
            composer={thread.composer}
            className="md:min-h-0"
            scrollerClassName="max-md:flex-none max-md:overflow-visible md:-ml-2 md:pl-2 md:pr-6"
            contentClassName="max-w-none px-0 pt-0.5 pb-4"
            composerClassName="max-w-none px-0 pb-0 md:pr-6"
          />
        ) : (
          <Stack
            gap={5}
            className="min-w-0 flex-1 md:-ml-2 md:min-h-0 md:overflow-y-auto md:py-0.5 md:pr-6 md:pl-2"
          >
            {main}
          </Stack>
        )}
        <PropertyList
          as="aside"
          aria-label={t('detail.details')}
          className="shrink-0 md:-mr-2 md:min-h-0 md:w-[17rem] md:overflow-y-auto md:border-l md:py-0.5 md:pr-2 md:pl-6"
        >
          {/* The panel's own headings sit under it, not under the thread's. */}
          <h2 className="sr-only">{t('detail.details')}</h2>
          {panel}
        </PropertyList>
      </div>
      {footer && <div className="shrink-0">{footer}</div>}
    </Stack>
  );
}

/** What the task's agent runs cost together. Each run's own cost stays on its
 *  line in the conversation; the total is a fact about the task, so it sits
 *  with its details — also once the task moved on to a person. Absent until a
 *  run cost anything. */
function TaskAgentCostField({ taskId }: { taskId: string }) {
  const { t } = useT('tasks');
  const { totalCostCents } = useTaskTimeline(taskId);
  if (totalCostCents <= 0) return null;
  return (
    <PropertyRow label={t('agentRuns.costLabel')}>
      <Text as="span" className="text-sm tabular-nums">
        {t('agentRuns.totalCost', { amount: formatCents(totalCostCents) })}
      </Text>
    </PropertyRow>
  );
}

/**
 * The details panel while the task is on its way: the fields every task
 * shows, named, with their values masked on the line they will fill.
 */
function TaskDetailsSkeleton({ showProject }: { showProject: boolean }) {
  const { t } = useT('tasks');
  const labels = [
    ...(showProject ? [t('fields.project')] : []),
    t('fields.status'),
    t('fields.priority'),
    t('fields.assignee'),
    t('fields.reviewer'),
    t('startDate.label'),
    t('dueDate.label'),
    t('repeat.label'),
  ];
  return (
    <>
      {labels.map((label, index) => (
        <PropertyRow key={label} label={label}>
          <span className="block w-28 max-w-full text-sm leading-7">
            <SkeletonText seed={index + 3} />
          </span>
        </PropertyRow>
      ))}
    </>
  );
}

// ───────────────────────────────── Create ─────────────────────────────────

/** Switcher between the blank create form and the board's subject templates
 *  (contracts with `create.enabled`) — hidden when none is deployed. */
function TemplateChips({
  templates,
  active,
  onPick,
}: {
  templates: ResolvedTaskSubjectContract[];
  active: string | null;
  onPick: (slug: string | null) => void;
}) {
  const { t } = useT('tasks');
  if (templates.length === 0) return null;
  return (
    <Row gap={2} className="flex-wrap">
      <Button
        size="sm"
        variant={active === null ? 'secondary' : 'ghost'}
        onClick={() => onPick(null)}
      >
        {t('template.blank')}
      </Button>
      {templates.map((entry) => (
        <Button
          key={entry.automationSlug}
          size="sm"
          variant={active === entry.automationSlug ? 'secondary' : 'ghost'}
          onClick={() => onPick(entry.automationSlug)}
        >
          <Workflow className="size-3.5" aria-hidden />
          {entry.displayName}
        </Button>
      ))}
    </Row>
  );
}

/** Anchored-regex gate from the contract's `input.naming`. An invalid
 *  pattern fails OPEN (create proceeds) but logs — a broken contract should
 *  not brick the create dialog. */
function matchesNaming(naming: string, value: string): boolean {
  try {
    return new RegExp(naming).test(value);
  } catch (error) {
    console.warn('[tasks] invalid contract naming pattern', naming, error);
    return true;
  }
}

/** DOM id linking the setup gate's `<form>` (in the scroll body) to its
 * submit button (in the modal footer) via the `form` attribute. */
const SETUP_FORM_ID = 'automation-settings-setup';

/** Whether creating from the template writes project files — the subject's
 * folder, or the settings its required forms save on first use. Project
 * files are the project editors', so only they are offered such a template;
 * every other reader creates the plain task. */
function templateWritesProjectFiles(
  template: ResolvedTaskSubjectContract,
): boolean {
  return (
    template.contract.input?.kind === 'folder' ||
    (template.settings?.forms ?? []).some(
      (form) => isFieldsForm(form) && form.required === true,
    )
  );
}

/**
 * The one-field template create: the subject's natural key (e.g. a period
 * folder name) is the only input — the contract derives the title, provisions
 * the bound input folder, and stamps the automation as owner. The run itself
 * starts later, through the status choreography.
 */
function TemplateCreateBody({
  organizationId,
  projectId,
  template,
  chips,
  canEditProject,
  onClose,
  onCreated,
}: {
  organizationId: string;
  projectId: string;
  template: ResolvedTaskSubjectContract;
  chips: ReactNode;
  /** The viewer edits the project: the automation's settings files there
   * are theirs to change. */
  canEditProject: boolean;
  onClose: () => void;
  /** Open the created (or re-picked) task right away — the subject panel
   * there names the next step instead of leaving the card silent in Backlog. */
  onCreated?: (taskId: string) => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { t: tAutomations } = useT('automations');
  const { locale } = useLocale();
  // The create's catch below toasts a refusal itself, a missing setup
  // folder by name.
  const createFromTemplate = useBackendAction(
    'tasks/public_actions:createTaskFromExternalIssue',
    { errorToast: false },
  );
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Mirror of the setup form's save-in-flight state — the submit button lives
  // in the modal footer, outside the <form> it targets.
  const [setupSaving, setSetupSaving] = useState(false);

  const { automationSlug, displayName, contract, settings } = template;
  const settingsFolder =
    settings === null ? null : resolveSettingsFolder(settings, contract);
  // Uploads panels never gate creation — only field forms can be required.
  const requiredForms = (settings?.forms ?? [])
    .filter(isFieldsForm)
    .filter((form) => form.required === true);

  // First-time gate: a template whose settings declare REQUIRED forms reads
  // the project's files before offering the name field — a project that has
  // never been set up walks through setup right here, and the settings form
  // it mounts shares this very query. A read that FAILS falls through to the
  // create step: the create action still fails closed on a missing setup
  // folder, so a hiccup must not brick the dialog.
  const stored = useAutomationSettingsValues(
    organizationId,
    projectId,
    settingsFolder,
    settings,
  );
  const setupNeeded =
    requiredForms.length > 0 &&
    stored.data !== undefined &&
    !requiredForms.every((form) =>
      settingsFormSatisfied(form, stored.data[form.file] ?? {}),
    );
  // Save-and-continue wins over the derived phase: the files it just wrote may
  // still be refetching, and the gate must not re-open behind it.
  const [chosenPhase, setChosenPhase] = useState<'create' | null>(null);
  const phase: 'checking' | 'setup' | 'create' =
    chosenPhase ??
    (requiredForms.length > 0 && stored.isPending
      ? 'checking'
      : setupNeeded
        ? 'setup'
        : 'create');
  // Editing settings later is its own dialog — a nested surface with its own
  // Save and its own discard guard, rather than a second body inside this one.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { i18n: fieldI18n, ...fieldBase } = contract.create?.field ?? {};
  const baseLocale = locale.split('-')[0] ?? locale;
  const text = {
    ...fieldBase,
    ...fieldI18n?.[baseLocale],
    ...fieldI18n?.[locale],
  };
  const naming =
    contract.input?.kind === 'folder' ? contract.input.naming : undefined;
  const trimmed = name.trim();
  const nameOk =
    trimmed.length > 0 &&
    (naming === undefined || matchesNaming(naming, trimmed));
  const showInvalid = trimmed.length > 0 && !nameOk && naming !== undefined;

  const submit = async () => {
    if (!nameOk || submitting) return;
    setSubmitting(true);
    try {
      const result = await createFromTemplate.mutateAsync({
        organizationId,
        projectId,
        externalSystem: contract.externalSystem ?? automationSlug,
        ...(contract.input?.kind === 'folder'
          ? {
              ensureFolder: {
                name: trimmed,
                ...(contract.input.setupFolderName !== undefined && {
                  setupFolderName: contract.input.setupFolderName,
                }),
              },
            }
          : { externalId: trimmed }),
        title:
          contract.create?.titleTemplate?.replace('{name}', trimmed) ?? trimmed,
        // No description is written: the automation's own description is shown
        // live by the subject panel (`displayDescription`), so copying a
        // per-automation sentence into every task's editable body would only
        // create N stale duplicates of one string — and leave the task with a
        // "description" nobody wrote and everybody has to read past.
        automationSlug,
      });
      toast({
        title: result.created ? t('template.created') : t('template.exists'),
        variant: result.created ? 'success' : undefined,
      });
      onClose();
      // Land inside the task right away: its subject panel says what comes
      // next (upload input files / Start) instead of leaving the new card
      // silent in Backlog.
      onCreated?.(result.taskId);
    } catch (error) {
      if (
        error instanceof AppError &&
        error.data?.code === 'SETUP_FOLDER_MISSING'
      ) {
        toast({
          title: t('template.setupMissing', {
            folder: contract.input?.setupFolderName ?? '',
          }),
          variant: 'destructive',
        });
      } else {
        console.error('[tasks] template create failed', error);
        toast({
          title: tCommon('errors.generic'),
          description: failureDetail(error),
          variant: 'destructive',
        });
      }
      setSubmitting(false);
    }
  };

  const header = (
    <ResponsiveDialogTitle className="text-lg leading-snug font-semibold">
      {t('actions.create')}
    </ResponsiveDialogTitle>
  );
  const panel = (
    <Stack gap={3}>
      <Text as="p" variant="muted">
        {t('automation.hint', { name: displayName })}
      </Text>
      {settings !== null && phase === 'create' && canEditProject && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="size-3.5" aria-hidden />
          {t('template.settingsOpen')}
        </Button>
      )}
    </Stack>
  );
  const cancelButton = (
    // Also locked while the setup gate is saving: dismissing mid-save would
    // race the files being written (`setupSaving` is false in other phases).
    <Button
      variant="secondary"
      onClick={onClose}
      disabled={submitting || setupSaving}
    >
      {tCommon('actions.cancel')}
    </Button>
  );

  if (phase === 'checking') {
    return (
      <ModalLayout
        header={header}
        main={
          <>
            {chips}
            <Text as="p" variant="muted">
              {tAutomations('settings.loading')}
            </Text>
          </>
        }
        panel={panel}
        footer={
          <Row gap={2} justify="end">
            {cancelButton}
          </Row>
        }
      />
    );
  }

  // The first-time gate: creation waits until every required file is written.
  if (phase === 'setup' && settings !== null && settingsFolder !== null) {
    return (
      <ModalLayout
        header={header}
        main={
          <>
            {chips}
            <Text as="p" variant="muted">
              {t('template.setupIntro', {
                name: displayName,
                folder: settingsFolder,
              })}
            </Text>
            <AutomationSettingsForm
              organizationId={organizationId}
              projectId={projectId}
              settings={settings}
              folder={settingsFolder}
              formId={SETUP_FORM_ID}
              onSavingChange={setSetupSaving}
              onSaved={() => {
                toast({
                  title: tAutomations('settings.saved'),
                  variant: 'success',
                });
                setChosenPhase('create');
              }}
            />
          </>
        }
        panel={panel}
        footer={
          <Row gap={2} justify="end">
            {cancelButton}
            {/* Targets the settings <form> in the body via the `form`
                attribute — one action row beside Cancel. (In the auto-height
                create dialog this row scrolls with the page; only the
                fixed-height edit dialog truly pins its footer.) */}
            <Button type="submit" form={SETUP_FORM_ID} isLoading={setupSaving}>
              {tAutomations('settings.saveAndContinue')}
            </Button>
          </Row>
        }
      />
    );
  }

  return (
    <>
      <ModalLayout
        header={header}
        main={
          <>
            {chips}
            <Input
              id="task-template-name"
              label={text.label ?? t('template.nameLabel')}
              placeholder={text.placeholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              autoFocus
              required
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            {(showInvalid || text.help !== undefined) && (
              <Text as="p" variant="muted">
                {showInvalid
                  ? t('template.invalidName', { pattern: naming ?? '' })
                  : text.help}
              </Text>
            )}
          </>
        }
        panel={panel}
        footer={
          <Row gap={2} justify="end">
            {cancelButton}
            <Button
              onClick={() => void submit()}
              disabled={!nameOk}
              isLoading={submitting}
            >
              {t('actions.create')}
            </Button>
          </Row>
        }
      />
      {settings !== null && settingsFolder !== null && (
        <AutomationSettingsDialog
          organizationId={organizationId}
          projectId={projectId}
          settings={settings}
          folder={settingsFolder}
          automationName={displayName}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}
    </>
  );
}

function CreateTaskBody({
  organizationId,
  projectId,
  defaultStatus,
  draft,
  onClose,
  onCreated,
  onTaskCreated,
}: {
  organizationId: string;
  projectId: string;
  defaultStatus: TaskStatus;
  draft?: TaskDraft;
  onClose: () => void;
  /** Open the created (or re-picked) task — the template flow lands the user
   * inside the task modal where the subject panel names the next step. */
  onCreated?: (taskId: string) => void;
  /** The blank form's create, reported by the caller instead of the plain
   * toast. */
  onTaskCreated?: (taskId: string) => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { formatNumber } = useFormatNumber();
  const createTask = useCreateTask();
  // Every reader of the project creates tasks; the label catalog and the
  // project's files stay its editors'.
  const { project } = useProject(projectId);
  const canEditProject = project?.canEdit === true;
  // Subject templates: contracts with `create.enabled` offer one chip each;
  // a one-field create beside the blank form.
  const subjectTemplates = useTaskSubjectTemplates(organizationId, projectId);
  const templates = canEditProject
    ? subjectTemplates
    : subjectTemplates.filter((entry) => !templateWritesProjectFiles(entry));
  const [templateSlug, setTemplateSlug] = useState<string | null>(null);
  const activeTemplate =
    templates.find((entry) => entry.automationSlug === templateSlug) ?? null;
  const {
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    clearAttachments,
  } = useFileUpload({
    organizationId,
    allowedTypes: [...TASK_UPLOAD_ALLOWED_TYPES],
    ...(draft !== undefined && { initialAttachments: draft.attachments }),
  });

  const [title, setTitle] = useState(draft?.title ?? '');
  const [description, setDescription] = useState(draft?.description ?? '');
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const pasteCounterRef = useRef(1);
  const [priority, setPriority] = useState<TaskPriority | null>(
    DEFAULT_NEW_TASK_PRIORITY,
  );
  const [assignee, setAssignee] = useState<{
    type: TaskActorType;
    id: string;
  } | null>(draft?.assignee ?? null);
  const [dueDate, setDueDate] = useState<number | undefined>(undefined);
  const [startDate, setStartDate] = useState<number | undefined>(() =>
    defaultNewTaskStartDate(),
  );
  const [repeat, setRepeat] = useState<TaskRepeat | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [labelsManageOpen, setLabelsManageOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  // After a create with "Create another", the caret goes back to Title once
  // the field is enabled again (it is disabled while the create runs).
  const refocusTitleRef = useRef(false);
  useEffect(() => {
    if (submitting || !refocusTitleRef.current) return;
    refocusTitleRef.current = false;
    titleRef.current?.focus();
  }, [submitting]);
  const isMac = useIsMac();
  // "Create another" belongs to the board's own create: the chat hand-over
  // links a source thread and announces itself, and a template opens what it
  // made, so neither loops.
  const canCreateAnother = draft === undefined && onTaskCreated === undefined;
  const [createAnother, setCreateAnother] = usePersistedState(
    'tale.platform.tasks.createAnother',
    false,
  );
  const createsAnother = canCreateAnother && createAnother;
  // A start after the due date is refused by the server; say so where the
  // dates are, before Create, rather than in a toast after it.
  const scheduleInvalid =
    startDate !== undefined && dueDate !== undefined && startDate > dueDate;
  const uploading = uploadingFiles.length > 0;
  // A rule belongs on open work a person or agent carries: a task created
  // straight into Done or Cancelled would never come back, and one handed to
  // an automation follows the automation's lifecycle. Choosing either drops
  // the rule — so switching back does not revive it unseen — and the row
  // reads Never, saying why.
  const repeatState = taskRepeatFieldState({
    mode: 'create',
    canMutate: true,
    status,
    automationOwned: assignee?.type === 'app',
  });
  // A pasted description over the cap is named under the field and holds
  // Create, as the task's own description editor does.
  const {
    overCap: descriptionOverCap,
    hint: descriptionHint,
    counterMax: descriptionCounterMax,
    counterValue: descriptionCounterValue,
  } = useDescriptionCap(description);
  // Create waits for a title, a description within its cap, a schedule the
  // server takes and every file that is still uploading.
  const canSubmit =
    title.trim().length > 0 &&
    !descriptionOverCap &&
    !scheduleInvalid &&
    !uploading;
  const { resolveActor } = useActorDirectory(organizationId, projectId);
  // Named beside the avatar, as on the task's own details panel — the bare
  // avatar button left "who takes this" to a hover.
  const assigneeName = assignee
    ? resolveActor(assignee.type, assignee.id).name
    : t('assignee.unassigned');

  // An agent-owned card created at In progress gets its run at once (the
  // server's own rule), so the verb says so; one created in Backlog or To do
  // waits for a Start, so it can be created started instead.
  const agentAssigned = assignee?.type === 'agent';
  const startsOnCreate = agentAssigned && status === 'in_progress';
  const offerStart =
    agentAssigned && (status === 'backlog' || status === 'todo');
  const startFirst = offerStart && draft?.startAgent === true;

  const submit = async (options: { start?: boolean } = {}) => {
    const trimmed = title.trim();
    if (!trimmed || submitting || !canSubmit) return;
    setSubmitting(true);
    try {
      const taskId = await createTask.mutateAsync({
        organizationId,
        projectId,
        title: trimmed,
        description: description.trim() || undefined,
        attachments: attachments.length
          ? stripPreviews(attachments)
          : undefined,
        status: options.start === true ? 'in_progress' : status,
        priority: priority ?? undefined,
        labels: labels.length ? labels : undefined,
        assigneeType: assignee?.type,
        assigneeId: assignee?.id,
        startDate,
        dueDate,
        repeat:
          repeatState.kind === 'editable' && repeat !== null
            ? repeat
            : undefined,
        ...(draft?.sourceThreadId !== undefined
          ? { sourceThreadId: draft.sourceThreadId }
          : {}),
      });
      if (onTaskCreated === undefined) {
        toastTaskCreated({
          title: t('actions.created'),
          openLabel: t('actions.openCreated'),
          openAltText: t('actions.openCreatedAltText'),
          onOpen: () => {
            onClose();
            onCreated?.(taskId);
          },
        });
      }
      if (createsAnother) {
        // Ready for the next one: the words and files go, everything a run of
        // similar tasks shares — status, priority, assignee, dates, repeat,
        // labels — stays.
        setTitle('');
        setDescription('');
        clearAttachments();
        pasteCounterRef.current = 1;
        refocusTitleRef.current = true;
        setSubmitting(false);
        return;
      }
      onClose();
      onTaskCreated?.(taskId);
    } catch (error) {
      console.error('Create task error:', error);
      const code = error instanceof AppError ? error.data?.code : undefined;
      const limitRefusal = taskLimitRefusalMessage(error, t, formatNumber);
      // A start the organization's policy refuses takes the create with it
      // (one transaction): say which, so Create without starting is the
      // obvious way on.
      const runRefusal = taskRunErrorMessage(error, t);
      if (code === 'TASK_SCHEDULE_INVALID') {
        toast({ title: t('startDate.afterDue'), variant: 'destructive' });
      } else if (code === 'PROJECT_ARCHIVED') {
        // The project was archived under the open dialog (or the board's
        // CTA was stale): say so instead of "something went wrong".
        toast({ title: t('errors.PROJECT_ARCHIVED'), variant: 'destructive' });
      } else if (limitRefusal !== undefined) {
        toast({ title: limitRefusal, variant: 'destructive' });
      } else if (runRefusal !== undefined) {
        toast({ title: runRefusal, variant: 'destructive' });
      } else {
        toast({
          title: tCommon('errors.generic'),
          description: failureDetail(error),
          variant: 'destructive',
        });
      }
      setSubmitting(false);
    }
  };

  // A paste ANYWHERE in the dialog carrying image bytes (a screenshot, a
  // copied image) attaches it — the same images-over-text-fallback rule the
  // chat composer applies, so a copied screenshot never lands as alt-text
  // prose in the description field instead.
  const onPasteImages = (event: ClipboardEvent<HTMLDivElement>) => {
    if (submitting) return;
    const files = extractPastedImageFiles(
      event.clipboardData,
      () => pasteCounterRef.current++,
    );
    if (files.length === 0) return;
    event.preventDefault();
    void uploadFiles(files);
  };

  const chips = (
    <TemplateChips
      templates={templates}
      active={activeTemplate?.automationSlug ?? null}
      onPick={setTemplateSlug}
    />
  );

  if (activeTemplate !== null) {
    return (
      <TemplateCreateBody
        // Keyed so a template switch REMOUNTS the body: the setup-gate check
        // and its phase state are mount-scoped per automation.
        key={activeTemplate.automationSlug}
        organizationId={organizationId}
        projectId={projectId}
        template={activeTemplate}
        chips={chips}
        canEditProject={canEditProject}
        onClose={onClose}
        onCreated={onCreated}
      />
    );
  }

  return (
    // display:contents — a paste-event catcher, never a layout box.
    <div className="contents" onPaste={onPasteImages}>
      <ModalLayout
        header={
          // The task as it will read: its status as the glyph tile and its
          // title in the same place and weight as the open task's own header,
          // so creating and reading a task look alike. The dialog's name
          // stays the verb.
          <Stack gap={2} className="md:pr-10">
            <ResponsiveDialogTitle className="text-muted-foreground text-xs font-medium">
              {t('actions.create')}
            </ResponsiveDialogTitle>
            <Row gap={3} align="center">
              <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
                <TaskStatusGlyph status={status} />
              </span>
              <input
                ref={titleRef}
                id="task-title"
                aria-label={t('fields.title')}
                placeholder={t('fields.titlePlaceholder')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
                autoFocus
                required
                // Hard-cap at the server limit (validateTitle rejects >
                // TASK_TITLE_MAX) so an over-long title can't reach the
                // mutation and strand the dialog behind a generic error toast.
                maxLength={TASK_TITLE_MAX}
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  // Cmd/Ctrl+Enter creates; a plain Enter moves on to the
                  // description, as a title is one line.
                  if (e.metaKey || e.ctrlKey)
                    void submit({ start: startFirst });
                  else document.getElementById('task-description')?.focus();
                }}
                className="text-foreground placeholder:text-muted-foreground hover:bg-muted/50 focus:bg-muted/50 -mx-1 min-w-0 flex-1 rounded-md bg-transparent px-1 text-lg leading-snug font-semibold outline-none disabled:opacity-60"
              />
            </Row>
          </Stack>
        }
        main={
          <>
            {chips}
            <MentionTextarea
              id="task-description"
              organizationId={organizationId}
              projectId={projectId}
              label={t('fields.description')}
              rows={8}
              value={description}
              onValueChange={setDescription}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter creates from the description too; a plain
                // Enter stays a new line.
                if (
                  (e.metaKey || e.ctrlKey) &&
                  e.key === 'Enter' &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void submit({ start: startFirst });
                }
              }}
              errorMessage={descriptionHint}
              counterMax={descriptionCounterMax}
              counterValue={descriptionCounterValue}
              disabled={submitting}
              placement="below"
            />
            <MentionTriggerChips
              organizationId={organizationId}
              projectId={projectId}
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
            <PropertyRow label={t('fields.status')}>
              <StatusPicker
                status={status}
                onChange={(next) => {
                  setStatus(next);
                  if (TASK_TERMINAL_STATUSES.has(next)) setRepeat(null);
                }}
                align="end"
              />
            </PropertyRow>
            <PropertyRow label={t('fields.priority')}>
              <PriorityPicker
                priority={priority}
                onChange={setPriority}
                align="end"
                showLabel
              />
            </PropertyRow>
            <PropertyRow label={t('fields.assignee')}>
              <AssigneePicker
                organizationId={organizationId}
                projectId={projectId}
                assigneeType={assignee?.type}
                assigneeId={assignee?.id}
                align="end"
                afterTrigger={
                  <span
                    className={cn(
                      'min-w-0 truncate text-sm',
                      assignee ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {assigneeName}
                  </span>
                }
                onAssign={(type, id) => {
                  setAssignee({ type, id });
                  if (!canTaskRepeat({ assigneeType: type })) setRepeat(null);
                }}
                onUnassign={() => setAssignee(null)}
              />
            </PropertyRow>
            <PropertyRow label={t('startDate.label')}>
              <DatePicker
                variant="ghost"
                className="w-full"
                value={startDate}
                onChange={(ms) => setStartDate(ms ?? undefined)}
              />
            </PropertyRow>
            <PropertyRow label={t('dueDate.label')}>
              <DatePicker
                variant="ghost"
                className="w-full"
                value={dueDate}
                onChange={(ms) => setDueDate(ms ?? undefined)}
              />
            </PropertyRow>
            {scheduleInvalid && (
              // Named where the dates are, and Create waits until it is fixed.
              <p role="alert" className="text-destructive text-xs">
                {t('startDate.afterDue')}
              </p>
            )}
            <PropertyRow label={t('repeat.label')}>
              <TaskRepeatField
                value={repeat}
                dueDate={dueDate}
                startDate={startDate}
                state={repeatState}
                onChange={(patch) => {
                  setRepeat(patch.repeat);
                  if (patch.dueDate !== undefined) setDueDate(patch.dueDate);
                }}
              />
            </PropertyRow>
            <PropertyDivider />
            <PropertyRow
              label={t('fields.labels')}
              stacked
              trailing={
                canEditProject ? (
                  <IconButton
                    icon={Settings2}
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground -my-1 size-6"
                    aria-label={t('labels.manage')}
                    onClick={() => setLabelsManageOpen(true)}
                  />
                ) : undefined
              }
            >
              <LabelEditor
                labels={labels}
                onChange={setLabels}
                projectId={projectId}
                canManage={canEditProject}
              />
            </PropertyRow>
            <LabelManageDialog
              open={labelsManageOpen}
              onOpenChange={setLabelsManageOpen}
              projectId={projectId}
              canEdit={canEditProject}
            />
          </>
        }
        footer={
          <Row gap={2} align="center" className="flex-wrap">
            {canCreateAnother && (
              <Switch
                checked={createAnother}
                onCheckedChange={setCreateAnother}
                label={t('actions.createAnother')}
                disabled={submitting}
              />
            )}
            {/* The shortcut, for a keyboard; a touch screen has none. */}
            <Text
              as="span"
              variant="muted"
              className="ml-auto text-xs max-md:hidden pointer-coarse:hidden"
            >
              {t('actions.createShortcut', {
                shortcut: isMac ? '⌘ Enter' : 'Ctrl + Enter',
              })}
            </Text>
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={submitting}
              className="max-md:ml-auto"
            >
              {tCommon('actions.cancel')}
            </Button>
            {offerStart && startFirst && (
              <Button
                variant="secondary"
                onClick={() => void submit()}
                disabled={!canSubmit || submitting}
              >
                {t('actions.createOnly')}
              </Button>
            )}
            {offerStart && !startFirst && (
              <Button
                variant="secondary"
                icon={Play}
                onClick={() => void submit({ start: true })}
                disabled={!canSubmit || submitting}
              >
                {t('actions.createAndStart')}
              </Button>
            )}
            <Button
              {...(startFirst || startsOnCreate ? { icon: Play } : {})}
              onClick={() => void submit({ start: startFirst })}
              disabled={!canSubmit}
              isLoading={submitting}
            >
              {startFirst || startsOnCreate
                ? t('actions.createAndStart')
                : t('actions.create')}
            </Button>
          </Row>
        }
      />
    </div>
  );
}

// ────────────────────────────────── Edit ──────────────────────────────────

export function EditTaskBody({
  taskId,
  active = true,
  organizationId,
  onOpenTask,
  onClose,
  showProjectLink = false,
  surface = 'dialog',
  pageActions,
}: {
  taskId: string;
  active?: boolean;
  /** Page surface: the page's organization, which frames the page while the
   *  task is still on its way. */
  organizationId?: string;
  onOpenTask?: (taskId: string) => void;
  onClose: () => void;
  showProjectLink?: boolean;
  /**
   * Where the body renders: inside the board's task dialog (its title is the
   * dialog's accessible name), or as a page of its own, where the task's
   * title is the page heading.
   */
  surface?: 'dialog' | 'page';
  /** Page surface: the page's own verbs in the thread header. */
  pageActions?: ReactNode;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const {
    task,
    canEdit,
    canCreate,
    canComment,
    ancestors,
    notFound,
    error: readError,
  } = useTask(taskId);
  usePrefetchTaskReads(taskId);
  // Editors work every task; any other reader of the project works the
  // tasks they created or are assigned to, and the subtasks under them —
  // the server's own rule.
  const { canWorkTask, canControlLiveRun } = useTaskAccess(
    task?.organizationId,
    { canEdit, canCreate },
  );
  const { project } = useProject(task?.projectId);
  // The refused start the banner shows, if one is the latest thing that
  // happened to the task.
  const latestRefusal = useLatestRunRefusal(taskId);
  const identifier = formatTaskIdentifier(project?.key, task?.number);
  const { copy } = useCopy();
  const copyIdentifier = () => {
    if (!identifier) return;
    void copy(identifier).then((copied) => {
      if (copied) toast({ title: t('detail.keyCopied', { key: identifier }) });
    });
  };
  const projectKey = project?.key ?? null;
  const { subtasks } = useSubtasks(taskId);
  // The Repeat row's neighbours: a subtask's parent (does it repeat?) and the
  // task a repeating one continues on. The links that name them read the
  // same tasks, so these share their cache.
  const { task: parentTask } = useTask(task?.parentTaskId);
  const { task: repeatNextTask } = useTask(task?.repeatNextTaskId);
  // The Repeat row's control, which takes focus back once "Stop repeating"
  // beside it goes through and leaves.
  const repeatControlId = useId();
  const { data: me } = useCurrentMemberContext(task?.organizationId);
  const actorDirectory = useActorDirectory(
    task?.organizationId ?? '',
    task?.projectId,
  );
  const { resolveActor, agents: projectAgents, agentsLoading } = actorDirectory;
  // The assigned agent still exists in the project — Start/Retry are for a
  // run that can happen. While the list loads, assume it does (no flicker).
  const assigneeLive =
    agentsLoading ||
    task?.assigneeType !== 'agent' ||
    projectAgents.some((agent) => agent.id === task.assigneeId);
  const { formatDate } = useFormatDate();
  const { formatNumber } = useFormatNumber();

  const updateTask = useUpdateTask({ errorToast: false });
  const backendClient = useBackendClient();
  const attachmentQueueRef = useRef(Promise.resolve());
  const updateStatus = useUpdateTaskStatus();
  // Status verbs on an automation-owned task route through the owning
  // workflow's choreography; a plain task keeps the bare write. Cancelling a
  // live run from the status picker asks first, same as the board drag.
  const { confirmCancel, dialog: cancelConfirmDialog } = useRunCancelConfirm();
  const choreograph = useTaskStatusChoreography(
    task?.organizationId ?? '',
    task?.projectId,
    { confirmCancel },
  );
  const ownedBy = useTaskSubjectContract(task?.organizationId ?? '', task);
  // A live run reads the bound folder mid-flight — "removing" an input file
  // permanently deletes the project document (blob + index), which would yank
  // it out from under the run. Same-args subscription as TaskSubjectPanel's,
  // so Convex serves both from one read.
  const liveRunQuery = useBackendQuery(
    'automations/queries:getLiveRunForTask',
    task != null && ownedBy !== null
      ? {
          organizationId: task.organizationId,
          projectId: task.projectId,
          taskId: task._id,
        }
      : 'skip',
  );
  // The latest run in ANY state feeds the property panel's Run row; the live
  // query above stays the one the verbs and guards read.
  const latestRunQuery = useBackendQuery(
    'automations/queries:getLatestRunForTask',
    task != null && ownedBy !== null
      ? {
          organizationId: task.organizationId,
          projectId: task.projectId,
          taskId: task._id,
        }
      : 'skip',
  );
  const latestRun = latestRunQuery.data ?? null;
  const { t: tAutomations } = useT('automations');
  // The owning automation's operator settings, opened from the task itself.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [labelsManageOpen, setLabelsManageOpen] = useState(false);
  const settingsFolder =
    ownedBy?.settings == null
      ? null
      : resolveSettingsFolder(ownedBy.settings, ownedBy.contract);
  const assignTask = useAssignTask();
  const { uploadingFiles, uploadFiles, clearAttachments } = useFileUpload({
    organizationId: task?.organizationId ?? '',
    allowedTypes: [...TASK_UPLOAD_ALLOWED_TYPES],
  });

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const pasteCounterRef = useRef(1);

  const onMutationError = (error: unknown) => {
    const closeRefusal = parentCloseRefusal(error, t);
    if (closeRefusal !== undefined) {
      toast({ title: closeRefusal, variant: 'destructive' });
      return;
    }
    // Setting In review → Done IS the review approve, so the org's
    // review_policy can refuse the picker — surface WHY, not a generic error.
    // So does a Reviewer the server refuses (the picker's list went stale).
    const reviewRefusal =
      reviewPolicyErrorMessage(error, t) ?? reviewerRefusalMessage(error, t);
    if (reviewRefusal !== undefined) {
      toast({ title: reviewRefusal, variant: 'destructive' });
      return;
    }
    // A title or description the server refused for its length names the
    // cap instead of the generic error below. The editors hold an over-long
    // draft back, so this is the backstop; saving a description an older
    // import stored past the cap used to answer that generic error.
    const limitRefusal = taskLimitRefusalMessage(error, t, formatNumber);
    if (limitRefusal !== undefined) {
      toast({ title: limitRefusal, variant: 'destructive' });
      return;
    }
    if (
      error instanceof AppError &&
      error.data?.code === 'TASK_SCHEDULE_INVALID'
    ) {
      toast({ title: t('startDate.afterDue'), variant: 'destructive' });
      return;
    }
    if (
      error instanceof AppError &&
      typeof error.data?.code === 'string' &&
      error.data.code.startsWith('TASK_LABEL')
    ) {
      toast({
        title: t(`labels.errors.${error.data.code}`, {
          defaultValue: tCommon('errors.generic'),
        }),
        variant: 'destructive',
      });
      return;
    }
    console.error('[tasks] detail action failed', error);
    toast({
      title: tCommon('errors.generic'),
      description: failureDetail(error),
      variant: 'destructive',
    });
  };

  if (!task) {
    if (surface === 'dialog') {
      // Settled on nothing (a deleted task, a stale notification link, a
      // tampered `?task=`) or broken: say so, with a way out — never a
      // skeleton that stays. The page surface has its own dead end
      // (`TaskDetailPage`).
      if (notFound || readError != null) {
        return (
          <TaskDetailFallback
            state={notFound ? 'missing' : 'error'}
            onClose={onClose}
          />
        );
      }
      // The dialog's own shape while the task is on its way — its key, its
      // title, the brief, the composer and the details, masked where each
      // will land — instead of an empty panel.
      return (
        <Skeletonize loading className="flex min-h-0 flex-1 flex-col">
          <ModalLayout
            header={
              <Stack gap={2}>
                <Text
                  as="span"
                  variant="muted"
                  className="w-12 font-mono text-xs tracking-wide"
                >
                  <SkeletonText />
                </Text>
                <ResponsiveDialogTitle className="sr-only">
                  {t('title')}
                </ResponsiveDialogTitle>
                <div className="w-72 max-w-full text-lg leading-snug font-semibold">
                  <SkeletonText seed={1} />
                </div>
              </Stack>
            }
            thread={{
              brief: (
                <div className="text-sm leading-6">
                  <SkeletonText lines={3} lastLineWidth="45%" seed={2} />
                </div>
              ),
              conversation: null,
              composer: <TaskCommentComposerSkeleton />,
            }}
            panel={<TaskDetailsSkeleton showProject={showProjectLink} />}
          />
        </Skeletonize>
      );
    }
    if (organizationId === undefined) return null;
    // The page's frame is there before the task is: the header, the brief,
    // the composer and the details keep their places with their values
    // masked. Same element in the same place as the loaded page below, so
    // the frame stays mounted and nothing moves when the task arrives.
    return (
      <div className="contents">
        <TaskPageLayout
          loading
          organizationId={organizationId}
          leading={
            <SkeletonBox asChild>
              <span className="bg-muted flex size-8 rounded-lg" />
            </SkeletonBox>
          }
          title={
            <span className="block w-48 max-w-full">
              <SkeletonText />
            </span>
          }
          meta={
            <span className="block w-36 max-w-full">
              <SkeletonText seed={1} />
            </span>
          }
          actions={pageActions}
          brief={
            <div className="text-sm leading-6">
              <SkeletonText lines={3} lastLineWidth="45%" seed={2} />
            </div>
          }
          conversation={null}
          composer={<TaskCommentComposerSkeleton />}
          panel={<TaskDetailsSkeleton showProject={showProjectLink} />}
        />
      </div>
    );
  }

  const isArchived = task.archivedAt != null;
  // Whoever may work the task changes it; the label catalog and the
  // project's files around it stay the project editors'.
  const canWork = canWorkTask(task, ancestors);
  const canMutate = canWork && !isArchived;
  const canEditProject = canEdit && !isArchived;
  // The rule is the open task's to change. A closed one keeps the rule it
  // closed with, one that already continued its series has handed it on for
  // good — even once that next task is deleted — and an automation's task
  // never repeats: each locked, saying why. A subtask has no rule of its
  // own: it comes back with a repeating parent, unless it is archived.
  const repeatState = taskRepeatFieldState({
    mode: 'details',
    canMutate,
    status: task.status,
    parentTaskId: task.parentTaskId,
    archived: isArchived,
    parentRepeats: parentTask ? parentTask.repeat !== undefined : undefined,
    parentLabel: parentTask
      ? (formatTaskIdentifier(projectKey, parentTask.number) ??
        parentTask.title)
      : undefined,
    automationOwned: taskAutomationOwned(task) || ownedBy !== null,
    repeats: task.repeat !== undefined,
    continued: task.repeatContinued === true,
    nextTaskId: task.repeatNextTaskId,
    nextRepeats: repeatNextTask
      ? repeatNextTask.repeat !== undefined
      : undefined,
    nextTaskLabel: repeatNextTask
      ? (formatTaskIdentifier(projectKey, repeatNextTask.number) ??
        repeatNextTask.title)
      : undefined,
  });
  // The series continues on a next task — both still carry the rule — and
  // this viewer may change it: "Stop repeating" stays beside the next
  // task's link, the "Next task created" toast's action, for as long as it
  // applies.
  const canStopRepeat =
    repeatState.kind === 'locked' && repeatState.reason === 'continued';
  // The bound project folder of an automation-owned task, when its contract
  // takes folder input — the ONE condition that swaps the Attachments zone
  // for the folder zones, and that keeps paste out of folder-bound tasks
  // (their input door is the folder, not attachments).
  const boundFolderId =
    ownedBy !== null &&
    ownedBy.contract.input?.kind === 'folder' &&
    typeof task.externalId === 'string' &&
    task.externalId !== ''
      ? task.externalId
      : null;

  const assigneeName =
    task.assigneeType && task.assigneeId
      ? resolveActor(task.assigneeType, task.assigneeId).name
      : t('assignee.unassigned');
  const author = resolveActor(task.createdByType, task.createdBy);
  const { done: subtasksDone, total: subtasksTotal } =
    subtaskProgress(subtasks);

  const enqueueAttachmentChange = (change: () => Promise<void>) => {
    const pending = attachmentQueueRef.current.then(change);
    attachmentQueueRef.current = pending.catch(onMutationError);
    return attachmentQueueRef.current;
  };
  const savedAttachments = async () => {
    const latest = await backendClient.query('tasks/queries:getTask', {
      organizationId: task.organizationId,
      taskId: task._id,
    });
    if (latest === null) throw new Error(tCommon('errors.generic'));
    return latest.task.attachments ?? [];
  };
  const onUploadAttachments = (files: File[]) =>
    uploadFiles(files)
      .catch(onMutationError)
      .then(() =>
        enqueueAttachmentChange(async () => {
          const added = clearAttachments();
          if (added.length === 0) return;
          const current = await savedAttachments();
          await updateTask.mutateAsync({
            taskId: task._id,
            attachments: stripPreviews([...current, ...added]),
          });
        }),
      );
  const onRemoveAttachment = (fileId: string) =>
    enqueueAttachmentChange(async () => {
      const current = await savedAttachments();
      await updateTask.mutateAsync({
        taskId: task._id,
        attachments: stripPreviews(
          current.filter((entry) => entry.fileId !== fileId),
        ),
      });
    });
  // A paste anywhere in the dialog carrying image bytes attaches it — same
  // rule as the chat composer (images win over the text/alt fallback). Kept
  // off folder-bound automation tasks, whose input door is the folder zone.
  const onPasteImages = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!canMutate || boundFolderId !== null) return;
    const files = extractPastedImageFiles(
      event.clipboardData,
      () => pasteCounterRef.current++,
    );
    if (files.length === 0) return;
    event.preventDefault();
    void onUploadAttachments(files);
  };

  const labelNames = (task.labels ?? []).map((l) => l.name);

  const labelsField = (
    <>
      <PropertyRow
        label={t('fields.labels')}
        stacked
        trailing={
          canEditProject ? (
            <IconButton
              icon={Settings2}
              size="sm"
              variant="ghost"
              className="text-muted-foreground -my-1 size-6"
              aria-label={t('labels.manage')}
              onClick={() => setLabelsManageOpen(true)}
            />
          ) : undefined
        }
      >
        <LabelEditor
          labels={labelNames}
          disabled={!canMutate}
          canManage={canEditProject}
          projectId={task.projectId}
          onChange={(labels) =>
            void updateTask
              .mutateAsync({ taskId: task._id, labels })
              .catch(onMutationError)
          }
        />
      </PropertyRow>
      <LabelManageDialog
        open={labelsManageOpen}
        onOpenChange={setLabelsManageOpen}
        projectId={task.projectId}
        canEdit={canEditProject}
      />
    </>
  );

  const repeatField =
    repeatState.kind === 'hidden' ? null : (
      <PropertyRow label={t('repeat.label')}>
        <TaskRepeatField
          id={repeatControlId}
          value={task.repeat ?? null}
          dueDate={task.dueDate}
          startDate={task.startDate}
          state={repeatState}
          onChange={(patch) =>
            void updateTask
              .mutateAsync({ taskId: task._id, ...patch })
              .catch(onMutationError)
          }
        />
        {task.repeatNextTaskId !== undefined && (
          <div className="flex flex-wrap items-center gap-x-1">
            <TaskRepeatNextLink
              nextTaskId={task.repeatNextTaskId}
              projectKey={projectKey}
              onOpenTask={onOpenTask}
            />
            {canStopRepeat && (
              <TaskRepeatStopButton
                taskId={task._id}
                nextTaskId={task.repeatNextTaskId}
                returnFocusTo={repeatControlId}
              />
            )}
          </div>
        )}
      </PropertyRow>
    );

  const dependenciesField = (
    <TaskDependencies
      task={task}
      canEdit={canMutate}
      projectKey={projectKey}
      onOpenTask={onOpenTask}
    />
  );

  // A description mirrored from an issue tracker keeps that tracker's
  // `@names`, which are not Tale's people.
  const descriptionPlainMentions =
    descriptionMentionMode(task.externalSystem) === 'full';
  const descriptionSection = (
    <section className="flex flex-col gap-1.5">
      {/* Empty + editable collapses to its own trigger: the heading and a
          six-row textarea for a field the reader may have nothing to say about
          used to own the top of every task — most of all an automation-owned
          one, where the job is uploading and starting, not writing prose. */}
      {canMutate ? (
        <EditableDescription
          key={task._id}
          taskId={task._id}
          organizationId={task.organizationId}
          projectId={task.projectId}
          value={task.description ?? ''}
          label={t('fields.description')}
          placeholder={t('detail.addDescription')}
          plainMentions={descriptionPlainMentions}
          onSave={(description) =>
            updateTask
              .mutateAsync({
                taskId: task._id,
                description: description.length ? description : null,
              })
              .catch((error: unknown) => {
                onMutationError(error);
                // Rethrow after reporting: the field keeps the editor open on
                // a failed write instead of dropping the typed draft.
                throw error;
              })
          }
        />
      ) : (
        <>
          <Text as="h3" variant="label">
            {t('fields.description')}
          </Text>
          {task.description ? (
            <MentionText
              body={task.description}
              organizationId={task.organizationId}
              projectId={task.projectId}
              plainMentions={descriptionPlainMentions}
            />
          ) : (
            <Text as="p" variant="muted">
              {t('detail.noDescription')}
            </Text>
          )}
        </>
      )}
    </section>
  );

  // The page's identity in the dialog's own header: the status as a glyph
  // tile, the title, and one quiet line of context — project, key, status —
  // so the dialog and the page read as the same task. The dialog's action
  // cluster (Copy link, Open as page, Close) floats at the top-right; the
  // header leaves it room from `md` up (the phone's drawer gives the cluster
  // a band of its own).
  const headerNode = (
    <Stack gap={2} className="md:pr-28">
      {task.parentTaskId && (
        <TaskParentLink
          parentTaskId={task.parentTaskId}
          projectKey={projectKey}
          onOpenTask={onOpenTask}
        />
      )}
      <Row gap={3} align="start">
        <span className="bg-muted mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
          <TaskStatusGlyph status={task.status} />
        </span>
        <Stack gap={1} className="min-w-0 flex-1">
          {surface === 'dialog' ? (
            <ResponsiveDialogTitle className="sr-only">
              {task.title}
            </ResponsiveDialogTitle>
          ) : (
            <h1 className="sr-only">{task.title}</h1>
          )}
          {canMutate ? (
            <EditableTitle
              key={task._id}
              active={active}
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
          <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
            <TaskMetaLine
              {...(project !== null && project !== undefined
                ? { projectName: project.name }
                : {})}
              {...(identifier ? { identifier } : {})}
              onCopyKey={copyIdentifier}
              status={task.status}
              isArchived={isArchived}
            />
          </div>
        </Stack>
      </Row>
    </Stack>
  );

  const briefNode = (
    <>
      <TaskRunFailureBanner
        taskId={task._id}
        organizationId={task.organizationId}
        projectId={task.projectId}
      />
      {/* The agent's run failed and the task still waits on it — unless a
          refused start is the newer account of why, said just above. */}
      {task.assigneeType === 'agent' &&
        task.assigneeId &&
        task.status === 'in_progress' &&
        latestRefusal === null && (
          <TaskAgentRunFailureNotice
            organizationId={task.organizationId}
            taskId={task._id}
            assigneeId={task.assigneeId}
            canRetry={canMutate && assigneeLive}
          />
        )}

      {/* A plain task's description IS its body, so it stays first. An
                automation-owned task leads with the work instead — who owns it,
                what it is, what to do next — and keeps the description as the
                optional note it is, below the files (see the tail of this
                column). */}
      <TaskExternalIssueCard
        externalSystem={task.externalSystem}
        externalId={task.externalId}
        externalUrl={task.externalUrl}
        externalIssue={task.externalIssue}
      />
      <TaskExternalStatusCard
        organizationId={task.organizationId}
        taskId={task._id}
        externalSystem={task.externalSystem}
        canWork={canWork && project?.archivedAt == null}
      />
      {ownedBy === null && descriptionSection}

      {ownedBy !== null && (
        <TaskSubjectPanel
          organizationId={task.organizationId}
          task={task}
          ownedBy={ownedBy}
          canEdit={canMutate}
        />
      )}

      {ownedBy !== null && boundFolderId !== null ? (
        <>
          <TaskInputFilesCard
            organizationId={task.organizationId}
            projectId={task.projectId}
            folderId={boundFolderId}
            contract={ownedBy.contract}
            automationName={ownedBy.displayName}
            // The bound folder's files are project documents — the project
            // editors' to add and remove, whoever works the task.
            canEdit={canEditProject}
            // Removal ends at review: from In review on, the folder is
            // the delivered evidence base — reviewers decide on what
            // the run actually read. It also pauses while a run is
            // LIVE (remove = permanent project-document delete, and a
            // mid-run delete yanks inputs out from under the agent);
            // an unresolved live-run fact locks rather than allows.
            canRemove={
              canEditProject &&
              task.status !== 'in_review' &&
              task.status !== 'done' &&
              task.status !== 'cancelled' &&
              liveRunQuery.data === null
            }
          />
          <TaskOutcomeFilesCard
            organizationId={task.organizationId}
            projectId={task.projectId}
            folderId={boundFolderId}
            contract={ownedBy.contract}
          />
        </>
      ) : (
        <TaskAttachments
          attachments={task.attachments ?? []}
          uploadingFiles={uploadingFiles}
          canEdit={canMutate}
          organizationId={task.organizationId}
          onUpload={onUploadAttachments}
          onRemove={onRemoveAttachment}
        />
      )}

      {/* Agent-run deliverables (harvested /agent/output) — read-only;
                the settle merges by fileName, so a rerun's same-named file
                replaces its row instead of stacking a copy. */}
      {(task.outputs?.length ?? 0) > 0 && (
        <TaskAttachments
          attachments={task.outputs ?? []}
          uploadingFiles={[]}
          canEdit={false}
          organizationId={task.organizationId}
          label={t('outputs.label')}
        />
      )}

      {ownedBy !== null && descriptionSection}

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
                        isCurrentUser={
                          subAssignee.type === 'user' &&
                          subAssignee.id === me?.userId
                        }
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {canMutate && (
          <SubtaskComposer
            organizationId={task.organizationId}
            projectId={task.projectId}
            parentTaskId={task._id}
            onError={onMutationError}
          />
        )}
      </Stack>
    </>
  );

  // The discussion as the task page reads it: one conversation, oldest first,
  // with the composer at its foot.
  const conversationNode = (
    <TaskConversation
      taskId={task._id}
      outputFiles={task.outputs ?? []}
      organizationId={task.organizationId}
      projectId={task.projectId}
      canComment={canComment}
      canWork={canWork}
      {...(me?.userId !== undefined ? { currentUserId: me.userId } : {})}
      {...(me?.isAdmin !== undefined ? { isAdmin: me.isAdmin } : {})}
    />
  );

  const composerNode = canComment ? (
    <TaskCommentComposer
      taskId={task._id}
      organizationId={task.organizationId}
      projectId={task.projectId}
      {...(task.assigneeType === 'agent' && task.assigneeId
        ? { hint: t('actions.commentAgentHint') }
        : {})}
    />
  ) : null;

  const panelNode = (
    <>
      {ownedBy !== null && (
        <Row gap={2} className="min-w-0">
          <TaskAutomationBadge
            organizationId={task.organizationId}
            task={task}
            showName
          />
          {/* The operator-owned configuration of the automation that
                    drives THIS task — reachable from the task, not only from
                    the create dialog it was first set up in. Saving writes
                    the project's files, so only its editors see the door. */}
          {ownedBy.settings !== null &&
            settingsFolder !== null &&
            canEditProject && (
              <IconButton
                icon={Settings2}
                size="sm"
                variant="ghost"
                className="ml-auto shrink-0"
                aria-label={tAutomations('settings.dialogTitle', {
                  name: ownedBy.displayName,
                })}
                onClick={() => setSettingsOpen(true)}
              />
            )}
        </Row>
      )}
      {showProjectLink && project !== null && (
        <PropertyRow label={t('fields.project')}>
          <Link
            to="/dashboard/$id/projects/$projectId/tasks/board"
            params={{
              id: task.organizationId,
              projectId: task.projectId,
            }}
            search={(prev) => {
              const next = { ...prev };
              delete next.projects;
              next.task = task._id;
              return next;
            }}
            className="text-foreground hover:text-foreground/80 focus-visible:ring-ring inline-block max-w-full truncate rounded-sm align-top text-sm leading-7 focus-visible:ring-2 focus-visible:outline-none"
          >
            {project.name}
          </Link>
        </PropertyRow>
      )}
      <PropertyRow label={t('fields.status')}>
        <StatusPicker
          status={task.status}
          disabled={!canMutate}
          align="end"
          optionDescription={
            ownedBy === null
              ? undefined
              : (option) => {
                  const kind = plannedTransitionKind(
                    ownedBy.contract,
                    task.status,
                    option,
                    task.status === 'in_progress',
                  );
                  return kind === null
                    ? undefined
                    : t(`automation.will.${kind}`, {
                        name: ownedBy.automationSlug,
                      });
                }
          }
          onChange={(status) =>
            void (async () => {
              const outcome = await choreograph(task, status);
              if (outcome !== 'move') return;
              await updateStatus
                .mutateAsync({ taskId: task._id, status })
                .catch(onMutationError);
            })()
          }
        />
      </PropertyRow>
      <PropertyRow label={t('fields.priority')}>
        <PriorityPicker
          priority={task.priority ?? null}
          disabled={!canMutate}
          align="end"
          showLabel
          onChange={(priority) =>
            void updateTask
              .mutateAsync({ taskId: task._id, priority })
              .catch(onMutationError)
          }
        />
      </PropertyRow>
      <PropertyRow label={t('fields.assignee')}>
        <AssigneePicker
          organizationId={task.organizationId}
          projectId={task.projectId}
          taskId={task._id}
          assigneeType={task.assigneeType}
          assigneeId={task.assigneeId}
          disabled={!canMutate}
          align="end"
          afterTrigger={
            // An empty value reads muted, like the dates' "Pick a date".
            <span
              className={cn(
                'min-w-0 truncate text-sm',
                task.assigneeType && task.assigneeId
                  ? 'text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {assigneeName}
            </span>
          }
          // `useAssignTask`'s own toast reports a refused assignment, naming
          // a live run that holds the task, as on every other picker.
          onAssign={(assigneeType, assigneeId) =>
            assignTask.mutate({
              taskId: task._id,
              assigneeType,
              assigneeId,
            })
          }
          onUnassign={() => assignTask.mutate({ taskId: task._id })}
        />
      </PropertyRow>
      {/* The agent lane's status + verbs live WITH the assignee — the
                run is Alice's state, not a second card in the task body. */}
      {task.assigneeType === 'agent' && task.assigneeId && (
        <PropertyRow label={t('agentRun.label')}>
          <TaskAgentRunEntry
            organizationId={task.organizationId}
            taskId={task._id}
            assigneeId={task.assigneeId}
            canEdit={canMutate}
            canStopRun={(startedBy) =>
              !isArchived && canControlLiveRun(task, startedBy, ancestors)
            }
            assigneeLive={assigneeLive}
          />
        </PropertyRow>
      )}
      <TaskAgentCostField taskId={task._id} />
      {/* The automation lane's twin: the latest subject-linked run's
                state and its step timeline, kept after the run finished so
                the result can still be audited from the task. Absent until a
                run exists — the subject panel's Start is the way in. */}
      {ownedBy !== null && latestRun !== null && (
        <PropertyRow label={t('run.label')}>
          <TaskAutomationRunEntry
            organizationId={task.organizationId}
            projectId={task.projectId}
            run={latestRun}
            name={ownedBy.displayName}
          />
        </PropertyRow>
      )}
      <PropertyRow label={t('fields.reviewer')}>
        <TaskReviewerField task={task} canEdit={canEditProject} />
      </PropertyRow>
      <PropertyRow label={t('startDate.label')}>
        <DatePicker
          variant="ghost"
          className="w-full"
          value={task.startDate}
          disabled={!canMutate}
          onChange={(startDate) =>
            void updateTask
              .mutateAsync({ taskId: task._id, startDate })
              .catch(onMutationError)
          }
        />
      </PropertyRow>
      <PropertyRow label={t('dueDate.label')}>
        <DatePicker
          variant="ghost"
          className="w-full"
          value={task.dueDate}
          disabled={!canMutate}
          onChange={(dueDate) =>
            void updateTask
              .mutateAsync({ taskId: task._id, dueDate })
              .catch(onMutationError)
          }
        />
      </PropertyRow>
      {/* An automation's task keeps its Repeat row in the fold below: it
          only says why the task does not repeat. */}
      {ownedBy === null && repeatField}

      <PropertyDivider />
      {/* Labels and dependencies are the BOARD's vocabulary. On an
                automation-owned task they are noise around the two properties
                that matter there (who owns it, where it stands), so they fold
                into one disclosure — the same controls, still one click away,
                just not competing with the work. */}
      {ownedBy !== null ? (
        <CollapsibleDetails
          summary={t('detail.moreFields')}
          variant="compact"
          className="shrink-0"
        >
          <Stack gap={4} className="pt-3">
            {repeatField}
            {labelsField}
            {dependenciesField}
          </Stack>
        </CollapsibleDetails>
      ) : (
        <>
          {labelsField}
          <PropertyDivider />
          {dependenciesField}
        </>
      )}

      <PropertyDivider />
      <PropertyRow label={t('fields.author')}>
        <div className="flex min-h-7 min-w-0 items-center gap-1.5">
          <AssigneeAvatar
            assigneeType={task.createdByType}
            assigneeId={task.createdBy}
            name={author.name}
          />
          <span className="text-foreground min-w-0 truncate text-sm">
            {author.name}
          </span>
        </div>
      </PropertyRow>
      <PropertyRow label={t('fields.created')}>
        <span className="text-foreground block text-sm leading-7">
          {formatDate(new Date(task.createdAt), 'medium')}
        </span>
      </PropertyRow>
      {/* Closes this section: who made the task, when — and whether the
                viewer hears about it. Watching needs read access only, so it
                sits outside the work gate that follows. */}
      <TaskWatchControl taskId={task._id} />
      {canWork && (
        <>
          <PropertyDivider />
          {/* shrink-0, like every PropertyRow: the panel is a
                    height-constrained flex column, and a flex item's automatic
                    minimum size only protects text — a fixed-height control
                    compresses to its one-line min-content, which rendered this
                    button at half height. A rule on the column can't fix it:
                    every Button sits inside its skeleton wrapper's
                    `display: contents` span, so the button, not the span, is
                    the flex item. */}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground w-full shrink-0"
            icon={isArchived ? ArchiveRestore : Archive}
            onClick={() => setArchiveOpen(true)}
          >
            {isArchived ? t('actions.restore') : t('actions.archive')}
          </Button>
          {/* Deleting is for owners and admins — the backend refuses anyone
                    else — so nobody else is offered a door that would fail. */}
          {me?.isAdmin === true && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive w-full shrink-0"
              icon={Trash2}
              onClick={() => setDeleteOpen(true)}
            >
              {t('actions.delete')}
            </Button>
          )}
        </>
      )}
    </>
  );

  return (
    <ActorDirectoryProvider
      organizationId={task.organizationId}
      projectId={task.projectId}
      directory={actorDirectory}
    >
      {/* display:contents — a paste-event catcher, never a layout box. */}
      <div className="contents" onPaste={onPasteImages}>
        {surface === 'dialog' ? (
          <ModalLayout
            header={headerNode}
            thread={{
              brief: briefNode,
              conversation: conversationNode,
              composer: composerNode,
            }}
            panel={panelNode}
          />
        ) : (
          <TaskPageLayout
            organizationId={task.organizationId}
            leading={
              <span className="bg-muted flex size-8 items-center justify-center rounded-lg">
                <TaskStatusGlyph status={task.status} />
              </span>
            }
            title={
              <>
                <h1 className="sr-only">{task.title}</h1>
                {canMutate ? (
                  <EditableTitle
                    key={task._id}
                    active={active}
                    value={task.title}
                    ariaLabel={t('fields.title')}
                    size="compact"
                    onSave={(title) =>
                      void updateTask
                        .mutateAsync({ taskId: task._id, title })
                        .catch(onMutationError)
                    }
                  />
                ) : (
                  <span aria-hidden>{task.title}</span>
                )}
              </>
            }
            meta={
              <TaskMetaLine
                projectVisibility="wide"
                {...(project !== null && project !== undefined
                  ? { projectName: project.name }
                  : {})}
                {...(identifier ? { identifier } : {})}
                onCopyKey={copyIdentifier}
                status={task.status}
                isArchived={isArchived}
              />
            }
            actions={pageActions}
            brief={briefNode}
            conversation={conversationNode}
            composer={composerNode}
            panel={panelNode}
          />
        )}
      </div>
      <TaskArchiveDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        taskId={task._id}
        taskTitle={task.title}
        isArchived={isArchived}
        onArchived={onClose}
      />
      <TaskDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        taskId={task._id}
        taskTitle={task.title}
        onDeleted={onClose}
      />
      {ownedBy?.settings != null && settingsFolder !== null && (
        <AutomationSettingsDialog
          organizationId={task.organizationId}
          projectId={task.projectId}
          settings={ownedBy.settings}
          folder={settingsFolder}
          automationName={ownedBy.displayName}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}
      {cancelConfirmDialog}
    </ActorDirectoryProvider>
  );
}

/**
 * The subtask field under a task's subtasks: its own draft, so typing a title
 * re-renders this row and not the task around it (the comments, the
 * timeline, the description).
 */
function SubtaskComposer({
  organizationId,
  projectId,
  parentTaskId,
  onError,
}: {
  organizationId: string;
  projectId: string;
  parentTaskId: string;
  onError: (error: unknown) => void;
}) {
  const { t } = useT('tasks');
  const createTask = useCreateTask();
  const [subtaskTitle, setSubtaskTitle] = useState('');

  const addSubtask = async () => {
    const subTitle = subtaskTitle.trim();
    if (!subTitle || createTask.isPending) return;
    try {
      await createTask.mutateAsync({
        organizationId,
        projectId,
        title: subTitle,
        status: 'todo',
        priority: DEFAULT_NEW_TASK_PRIORITY,
        parentTaskId,
      });
      setSubtaskTitle('');
    } catch (error) {
      onError(error);
    }
  };

  return (
    <Row gap={2}>
      {/* A one-line field, like the button beside it: a subtask is a
          title, and the one-row textarea it used to be stood a few
          pixels taller than the button and showed a resize grip. */}
      <Input
        id="new-subtask"
        value={subtaskTitle}
        onChange={(e) => setSubtaskTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!createTask.isPending) void addSubtask();
          }
        }}
        placeholder={t('detail.addSubtask')}
        aria-label={t('detail.addSubtask')}
        wrapperClassName="min-w-0 flex-1"
      />
      <Button
        icon={Plus}
        variant="secondary"
        disabled={subtaskTitle.trim().length === 0 || createTask.isPending}
        isLoading={createTask.isPending}
        onClick={() => void addSubtask()}
      >
        {t('actions.add')}
      </Button>
    </Row>
  );
}

// ───────────────────────── inline-editable helpers ─────────────────────────

/** Inline-editable single-line title; commits on blur / Enter, reverts on Escape. */
function EditableTitle({
  value,
  active,
  ariaLabel,
  onSave,
  size = 'default',
}: {
  value: string;
  active: boolean;
  ariaLabel: string;
  onSave: (value: string) => void;
  /** `compact` fits the thread header's title line. */
  size?: 'default' | 'compact';
}) {
  const [draft, setDraft] = useState(value);
  const settledRef = useRef(false);
  const { isComposing, compositionProps } = useImeComposition(active);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    else setDraft(value);
  };

  return (
    <input
      value={draft}
      {...compositionProps}
      aria-label={ariaLabel}
      // The create form's cap: a longer title is refused by the server.
      maxLength={TASK_TITLE_MAX}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        settledRef.current = false;
      }}
      onBlur={() => {
        compositionProps.onBlur();
        if (settledRef.current) return;
        settledRef.current = true;
        commit();
      }}
      onKeyDown={(e) => {
        if (isComposing(e.nativeEvent)) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          // Blur fires synchronously, before the draft reset reaches onBlur.
          settledRef.current = true;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className={cn(
        'text-foreground hover:bg-muted/50 focus:bg-muted/50 -mx-1 rounded-md px-1 font-semibold outline-none',
        size === 'compact'
          ? 'w-full min-w-0 truncate bg-transparent text-sm leading-5 tracking-tight'
          : 'text-lg leading-snug',
      )}
    />
  );
}
