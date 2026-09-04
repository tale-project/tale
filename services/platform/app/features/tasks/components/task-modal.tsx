'use client';

import { Button } from '@tale/ui/button';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  Plus,
  Settings2,
  Workflow,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactNode,
} from 'react';

import { DatePicker } from '@/app/components/ui/forms/date-picker';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
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
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { TASK_TITLE_MAX } from '@/backend/core/tasks/helpers';
import { useT } from '@/lib/i18n/client';
import { AppError } from '@/lib/shared/errors/app-error';
import { TASK_UPLOAD_ALLOWED_TYPES } from '@/lib/shared/file-types';
import { formatTaskIdentifier } from '@/lib/shared/project_key';
import {
  isFieldsForm,
  resolveSettingsFolder,
  settingsFormSatisfied,
} from '@/lib/shared/schemas/automation_settings';
import { cn } from '@/lib/utils/cn';

import {
  useAssignTask,
  useCreateTask,
  useSetTaskReviewer,
  useUpdateTask,
  useUpdateTaskStatus,
} from '../hooks/mutations';
import { useSubtasks, useTask } from '../hooks/queries';
import { useActorDirectory } from '../hooks/use-actor-directory';
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
  type TaskActorType,
  type TaskPriority,
  type TaskStatus,
} from '../lib/display';
import { reviewPolicyErrorMessage } from '../lib/review-policy-error';
import { subtaskProgress } from '../lib/subtasks';
import { AssigneeAvatar } from './assignee-avatar';
import { AssigneePicker } from './assignee-picker';
import { EditableDescription } from './editable-description';
import { LabelEditor } from './label-editor';
import { LabelManageDialog } from './label-manage-dialog';
import { MentionText } from './mention-text';
import { MentionTextarea } from './mention-textarea';
import { MentionTriggerChips } from './mention-trigger-chips';
import { PriorityPicker } from './priority-picker';
import { ReviewerPicker } from './reviewer-picker';
import { useRunCancelConfirm } from './run-cancel-confirm';
import { StatusPicker } from './status-picker';
import { TaskAgentRunEntry } from './task-agent-run-entry';
import { TaskArchiveDialog } from './task-archive-dialog';
import { TaskArchivedBadge } from './task-archived-badge';
import { TaskAttachments } from './task-attachments';
import { TaskAutomationBadge } from './task-automation-badge';
import { TaskComments } from './task-comments';
import { TaskDependencies } from './task-dependencies';
import { SubtaskProgress } from './task-indicators';
import { TaskInputFilesCard } from './task-input-files';
import { TaskOutcomeFilesCard } from './task-outcome-files';
import { TaskRunFailureBanner } from './task-run-failure-banner';
import { TaskStatusBadge } from './task-status-badge';
import { TaskSubjectPanel } from './task-subject-panel';
import { TaskTimeline } from './task-timeline';
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
  showProjectLink = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  projectId: string;
  /** Present → edit/view an existing task; absent → create a new one. */
  taskId?: string | null;
  /** Initial status for create mode (e.g. the "+" of a list section). */
  defaultStatus?: TaskStatus;
  /** Navigate to another task (subtasks / dependency links). */
  onOpenTask?: (taskId: string) => void;
  /** All-projects board: show a link to the task's project in the detail. */
  showProjectLink?: boolean;
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
            showProjectLink={showProjectLink}
          />
        ) : (
          <CreateTaskBody
            organizationId={organizationId}
            projectId={projectId}
            // Board creates default to `todo` so new tasks land in a visible lane.
            defaultStatus={defaultStatus ?? 'todo'}
            onClose={() => onOpenChange(false)}
            onCreated={onOpenTask}
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
 *  (or above it, for controls that wrap, like Labels).
 *
 *  The label WRAPS inside its column instead of overflowing it: the column is a
 *  fixed width so every control lines up, and a label longer than it — which
 *  English never produces but a German compound does on the first try — used to
 *  paint over its own control and give the whole panel a horizontal scrollbar.
 *  Wrapping keeps the field name fully readable, which truncation would not.
 *  This is the SAFETY NET, not the plan: a label that needs two lines here is a
 *  label to shorten per locale (`hyphens-auto` softens the break to a syllable
 *  only where the browser ships a dictionary for the document's `lang`). */
function PropertyField({
  label,
  children,
  stacked,
  trailing,
}: {
  label: string;
  children: ReactNode;
  /** `true` → label above the control at every width, for a control that wraps
   *  (Labels, Dependencies). `'md'` → stacked only where the panel is narrow
   *  (md+); below that the control moves up beside its label, into the same
   *  label column as the row variant. */
  stacked?: boolean | 'md';
  /** Optional control beside the field name (e.g. manage-labels settings). */
  trailing?: ReactNode;
}) {
  if (stacked) {
    // `'md'`: below the md breakpoint the dialog is a bottom drawer and the
    // property panel spans its FULL width, so a fixed-width control (a date)
    // fits beside its label with room to spare — stacking there spends a whole
    // row of a sheet that already scrolls. From md up the panel narrows to
    // 15.5rem, where the label column plus that control no longer fit on one
    // line, so it goes back to stacked.
    const inlineWhenWide = stacked === 'md';
    return (
      <div
        className={cn(
          'flex flex-col gap-1.5',
          inlineWhenWide &&
            'flex-row items-center gap-2 md:flex-col md:items-stretch md:gap-1.5',
        )}
      >
        <Row
          gap={1}
          align="center"
          className={cn(
            'min-h-4',
            // The SAME label column as the row variant below, so the control
            // starts in one vertical line with Status / Priority / Assignee
            // rather than floating at the panel's edge.
            inlineWhenWide && 'w-20 shrink-0 md:w-auto',
          )}
        >
          <span
            className={cn(
              'text-muted-foreground text-xs font-medium',
              // Same safety net as the row variant: wrap a long label inside
              // its own column instead of shoving the control off the sheet.
              inlineWhenWide && 'break-words hyphens-auto',
            )}
          >
            {label}
          </span>
          {trailing}
        </Row>
        {children}
      </div>
    );
  }
  return (
    <Row gap={2} align="start" className="min-h-7 shrink-0">
      <span className="text-muted-foreground w-20 shrink-0 pt-1 text-xs font-medium break-words hyphens-auto">
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
  onClose,
  onCreated,
}: {
  organizationId: string;
  projectId: string;
  template: ResolvedTaskSubjectContract;
  chips: ReactNode;
  onClose: () => void;
  /** Open the created (or re-picked) task right away — the subject panel
   * there names the next step instead of leaving the card silent in Backlog. */
  onCreated?: (taskId: string) => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const { t: tAutomations } = useT('automations');
  const { locale } = useLocale();
  const createFromTemplate = useBackendAction(
    'tasks/public_actions:createTaskFromExternalIssue',
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
        toast({ title: tCommon('errors.generic'), variant: 'destructive' });
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
      {settings !== null && phase === 'create' && (
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
            <Button type="submit" form={SETUP_FORM_ID} disabled={setupSaving}>
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
              disabled={submitting || !nameOk}
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
  onClose,
  onCreated,
}: {
  organizationId: string;
  projectId: string;
  defaultStatus: TaskStatus;
  onClose: () => void;
  /** Open the created (or re-picked) task — the template flow lands the user
   * inside the task modal where the subject panel names the next step. */
  onCreated?: (taskId: string) => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const createTask = useCreateTask();
  // Subject templates: contracts with `create.enabled` offer one chip each;
  // a one-field create beside the blank form.
  const templates = useTaskSubjectTemplates(organizationId, projectId);
  const [templateSlug, setTemplateSlug] = useState<string | null>(null);
  const activeTemplate =
    templates.find((entry) => entry.automationSlug === templateSlug) ?? null;
  const { attachments, uploadingFiles, uploadFiles, removeAttachment } =
    useFileUpload({
      organizationId,
      allowedTypes: [...TASK_UPLOAD_ALLOWED_TYPES],
    });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const pasteCounterRef = useRef(1);
  const [priority, setPriority] = useState<TaskPriority | null>(null);
  const [assignee, setAssignee] = useState<{
    type: TaskActorType;
    id: string;
  } | null>(null);
  const [dueDate, setDueDate] = useState<number | undefined>(undefined);
  const [startDate, setStartDate] = useState<number | undefined>(undefined);
  const [labels, setLabels] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [labelsManageOpen, setLabelsManageOpen] = useState(false);

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
        startDate,
        dueDate,
      });
      toast({ title: t('actions.created'), variant: 'success' });
      onClose();
    } catch (error) {
      console.error('Create task error:', error);
      if (
        error instanceof AppError &&
        error.data?.code === 'TASK_SCHEDULE_INVALID'
      ) {
        toast({ title: t('startDate.afterDue'), variant: 'destructive' });
      } else {
        toast({ title: tCommon('errors.generic'), variant: 'destructive' });
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
          <ResponsiveDialogTitle className="text-lg leading-snug font-semibold">
            {t('actions.create')}
          </ResponsiveDialogTitle>
        }
        main={
          <>
            {chips}
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
            <PropertyField label={t('startDate.label')} stacked="md">
              <DatePicker
                className="min-w-[10.5rem]"
                value={startDate}
                onChange={(ms) => setStartDate(ms ?? undefined)}
              />
            </PropertyField>
            <PropertyField label={t('dueDate.label')} stacked="md">
              <DatePicker
                className="min-w-[10.5rem]"
                value={dueDate}
                onChange={(ms) => setDueDate(ms ?? undefined)}
              />
            </PropertyField>
            <PanelDivider />
            <PropertyField
              label={t('fields.labels')}
              stacked
              trailing={
                <IconButton
                  icon={Settings2}
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground -my-1 size-6"
                  aria-label={t('labels.manage')}
                  onClick={() => setLabelsManageOpen(true)}
                />
              }
            >
              <LabelEditor
                labels={labels}
                onChange={setLabels}
                projectId={projectId}
              />
            </PropertyField>
            <LabelManageDialog
              open={labelsManageOpen}
              onOpenChange={setLabelsManageOpen}
              projectId={projectId}
              canEdit
            />
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
    </div>
  );
}

// ────────────────────────────────── Edit ──────────────────────────────────

function EditTaskBody({
  taskId,
  onOpenTask,
  onClose,
  showProjectLink = false,
}: {
  taskId: string;
  onOpenTask?: (taskId: string) => void;
  onClose: () => void;
  showProjectLink?: boolean;
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
  const { t: tAutomations } = useT('automations');
  // The owning automation's operator settings, opened from the task itself.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [labelsManageOpen, setLabelsManageOpen] = useState(false);
  const settingsFolder =
    ownedBy?.settings == null
      ? null
      : resolveSettingsFolder(ownedBy.settings, ownedBy.contract);
  const assignTask = useAssignTask();
  const setTaskReviewer = useSetTaskReviewer();
  const createTask = useCreateTask();
  const { uploadingFiles, uploadFiles, clearAttachments } = useFileUpload({
    organizationId: task?.organizationId ?? '',
    allowedTypes: [...TASK_UPLOAD_ALLOWED_TYPES],
  });

  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const pasteCounterRef = useRef(1);

  const onMutationError = (error: unknown) => {
    if (
      error instanceof AppError &&
      error.data?.code === 'TASK_HAS_OPEN_SUBTASKS'
    ) {
      toast({ title: t('detail.parentCloseGuard'), variant: 'destructive' });
      return;
    }
    // Setting In review → Done IS the review approve, so the org's
    // review_policy can refuse the picker — surface WHY, not a generic error.
    const reviewRefusal = reviewPolicyErrorMessage(error, t);
    if (reviewRefusal !== undefined) {
      toast({ title: reviewRefusal, variant: 'destructive' });
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
    toast({ title: tCommon('errors.generic'), variant: 'destructive' });
  };

  if (!task) {
    return <ResponsiveDialogTitle>{t('title')}</ResponsiveDialogTitle>;
  }

  const isArchived = task.archivedAt != null;
  const canMutate = canEdit && !isArchived;
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
  const reviewerName =
    task.reviewerUserId !== undefined
      ? resolveActor('user', task.reviewerUserId).name
      : t('reviewer.none');
  const author = resolveActor(task.createdByType, task.createdBy);
  const { done: subtasksDone, total: subtasksTotal } =
    subtaskProgress(subtasks);

  const addSubtask = async () => {
    const subTitle = subtaskTitle.trim();
    if (!subTitle || createTask.isPending) return;
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
      <PropertyField
        label={t('fields.labels')}
        stacked
        trailing={
          canMutate ? (
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
          projectId={task.projectId}
          onChange={(labels) =>
            void updateTask
              .mutateAsync({ taskId: task._id, labels })
              .catch(onMutationError)
          }
        />
      </PropertyField>
      <LabelManageDialog
        open={labelsManageOpen}
        onOpenChange={setLabelsManageOpen}
        projectId={task.projectId}
        canEdit={canMutate}
      />
    </>
  );

  const dependenciesField = (
    <TaskDependencies
      task={task}
      canEdit={canMutate}
      projectKey={projectKey}
      onOpenTask={onOpenTask}
    />
  );

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

  return (
    <>
      {/* display:contents — a paste-event catcher, never a layout box. */}
      <div className="contents" onPaste={onPasteImages}>
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

              {/* A plain task's description IS its body, so it stays first. An
                automation-owned task leads with the work instead — who owns it,
                what it is, what to do next — and keeps the description as the
                optional note it is, below the files (see the tail of this
                column). */}
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
                    canEdit={canMutate}
                    // Removal ends at review: from In review on, the folder is
                    // the delivered evidence base — reviewers decide on what
                    // the run actually read. It also pauses while a run is
                    // LIVE (remove = permanent project-document delete, and a
                    // mid-run delete yanks inputs out from under the agent);
                    // an unresolved live-run fact locks rather than allows.
                    canRemove={
                      canMutate &&
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
                    <SubtaskProgress
                      done={subtasksDone}
                      total={subtasksTotal}
                    />
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
                  <Row gap={2}>
                    <Textarea
                      id="new-subtask"
                      rows={1}
                      value={subtaskTitle}
                      onChange={(e) => setSubtaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (!createTask.isPending) void addSubtask();
                        }
                      }}
                      placeholder={t('detail.addSubtask')}
                      className="min-h-0"
                      wrapperClassName="min-w-0 flex-1"
                    />
                    <Button
                      icon={Plus}
                      variant="secondary"
                      disabled={
                        subtaskTitle.trim().length === 0 || createTask.isPending
                      }
                      isLoading={createTask.isPending}
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
                commentCount={task.commentCount}
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
              {ownedBy !== null && (
                <Row gap={2} className="min-w-0">
                  <TaskAutomationBadge
                    organizationId={task.organizationId}
                    task={task}
                    showName
                  />
                  {/* The operator-owned configuration of the automation that
                    drives THIS task — reachable from the task, not only from
                    the create dialog it was first set up in. */}
                  {ownedBy.settings !== null && settingsFolder !== null && (
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
                <PropertyField label={t('fields.project')}>
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
                    className="text-foreground hover:text-foreground/80 focus-visible:ring-ring min-w-0 truncate rounded-sm text-sm focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {project.name}
                  </Link>
                </PropertyField>
              )}
              <PropertyField label={t('fields.status')}>
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
              </PropertyField>
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
                  taskId={task._id}
                  assigneeType={task.assigneeType}
                  assigneeId={task.assigneeId}
                  taskTitle={task.title}
                  taskDescription={task.description}
                  taskLabels={labelNames}
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
              {/* The agent lane's status + verbs live WITH the assignee — the
                run is Alice's state, not a second card in the task body. */}
              {task.assigneeType === 'agent' && (
                <PropertyField label={t('agentRun.label')}>
                  <TaskAgentRunEntry
                    organizationId={task.organizationId}
                    taskId={task._id}
                    canEdit={canMutate}
                  />
                </PropertyField>
              )}
              {/* The named human the review gate waits on — soft designation
                (notify + Needs-my-review), so unlike the assignee it may
                change while a run is live. */}
              <PropertyField label={t('fields.reviewer')}>
                <ReviewerPicker
                  organizationId={task.organizationId}
                  projectId={task.projectId}
                  reviewerUserId={task.reviewerUserId}
                  disabled={!canMutate}
                  align="end"
                  afterTrigger={
                    <span className="text-foreground min-w-0 truncate text-sm">
                      {reviewerName}
                    </span>
                  }
                  onChange={(reviewerUserId) =>
                    void setTaskReviewer
                      .mutateAsync({ taskId: task._id, reviewerUserId })
                      .catch(onMutationError)
                  }
                />
              </PropertyField>
              <PropertyField label={t('startDate.label')} stacked="md">
                <DatePicker
                  className="min-w-[10.5rem]"
                  value={task.startDate}
                  disabled={!canMutate}
                  onChange={(startDate) =>
                    void updateTask
                      .mutateAsync({ taskId: task._id, startDate })
                      .catch(onMutationError)
                  }
                />
              </PropertyField>
              <PropertyField label={t('dueDate.label')} stacked="md">
                <DatePicker
                  className="min-w-[10.5rem]"
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
                    {labelsField}
                    {dependenciesField}
                  </Stack>
                </CollapsibleDetails>
              ) : (
                <>
                  {labelsField}
                  <PanelDivider />
                  {dependenciesField}
                </>
              )}

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
              {/* Closes this section: who made the task, when — and whether the
                viewer hears about it. Watching needs read access only, so it
                sits outside the canEdit gate that follows. */}
              <TaskWatchControl taskId={task._id} />
              {canEdit && (
                <>
                  <PanelDivider />
                  {/* shrink-0, like every PropertyField row: the panel is a
                    height-constrained flex column, and a flex item's automatic
                    minimum size only protects text — a fixed-height control
                    compresses to its one-line min-content, which rendered this
                    button at half height. A rule on the column can't fix it:
                    every Button sits inside its skeleton wrapper's
                    `display: contents` span, so the button, not the span, is
                    the flex item. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full shrink-0"
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
      </div>
      <TaskArchiveDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        taskId={task._id}
        taskTitle={task.title}
        isArchived={isArchived}
        onArchived={onClose}
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
