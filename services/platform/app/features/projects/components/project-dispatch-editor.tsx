'use client';

/**
 * The Dispatch page's editor: the whole dispatch of a project in one form —
 * its pool and limits, the ready work it takes, how carefully it starts on
 * the sandbox host, its standing roles and its gates. It starts from the
 * document managed configuration reads (`…/dispatch/by-project/:id/
 * configuration`) and saves over exactly that version: another session's
 * save in between is refused (`CONFIG_VERSION_CONFLICT`) and the editor
 * offers the current version instead of overwriting it. A refusal that names
 * fields (`DISPATCH_INVALID`) shows under those fields; every other failure
 * is the form's one save toast. A dispatch a newer version of Tale saved is
 * never offered for editing (`CONFIG_UNREADABLE`).
 */

import {
  DISPATCH_GATES_MAX,
  DISPATCH_LABELS_MAX,
  DISPATCH_POOL_MAX,
  DISPATCH_ROLE_BRIEF_MAX,
  DISPATCH_RUNS_MAX,
  DISPATCH_STANDING_ROLES_MAX,
} from '@tale/shared/schemas/project-dispatch';
import { formatTaskIdentifier } from '@tale/shared/utils/project-key';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { useFormEditor } from '@tale/ui/editor';
import { FormSection } from '@tale/ui/form-section';
import { Input } from '@tale/ui/input';
import { Row, Stack } from '@tale/ui/layout';
import { MultiSelect, type MultiSelectOption } from '@tale/ui/multi-select';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { Select } from '@tale/ui/select';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Switch } from '@tale/ui/switch';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { useFormatDate } from '@tale/ui/use-format-date';
import { toast } from '@tale/ui/use-toast';
import { Plus, Trash2, XCircle } from 'lucide-react';
import { useCallback, useId, useMemo, useRef, useState } from 'react';
import {
  type Control,
  Controller,
  type FieldErrors,
  type UseFormRegister,
  useFieldArray,
  useWatch,
} from 'react-hook-form';

import { listTimezoneOptions } from '@/app/features/automations/lib/timezones';
import {
  useTaskLabels,
  useTasksByProject,
} from '@/app/features/tasks/hooks/queries';
import { failureDetail } from '@/app/lib/backend/adapters';
import type { ProjectDispatchConfiguration } from '@/app/lib/backend/project-dispatch';
import { useT } from '@/lib/i18n/client';
import { AppError } from '@/lib/shared/errors/app-error';
import { backendErrorCode } from '@/lib/utils/backend-error';

import {
  useProjectDispatchConfiguration,
  useSaveProjectDispatch,
} from '../hooks/dispatch';
import { useProjectAgents } from '../hooks/queries';
import {
  DISPATCH_ROLE_MODE_MAX,
  type DispatchFormValues,
  type DispatchIssueKind,
  dispatchFormSchema,
  dispatchIssuesOf,
  emptyGate,
  emptyRole,
  placeIssue,
  toDispatch,
  toFormValues,
} from '../lib/dispatch-form';

export interface ProjectDispatchEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  projectId: string;
  projectKey: string | undefined;
  /** The organization's agent workers: how many runs at once a new
   * dispatch may hold to begin with. */
  workersLimit: number;
  /** Titles of the tasks the dispatch names, as its readback knows them —
   * for a task the board's list does not carry. */
  taskTitles: ReadonlyMap<string, string>;
  /** The page knows of no dispatch yet: the editor sets one up. What the
   * editor then reads decides. */
  settingUp: boolean;
}

/** Mounted only while open (see `Dialog`): every opening reads the stored
 * dispatch afresh, and a closed editor keeps no draft and no reads. */
export function ProjectDispatchEditor(props: ProjectDispatchEditorProps) {
  if (!props.open) return null;
  return <DispatchEditorDialog {...props} />;
}

const NO_VALUES: never[] = [];

/** The error text under a select that cannot carry it itself, read with the
 * control (`aria-describedby`) and announced when it appears. */
function SelectError({ id, message }: { id: string; message?: string }) {
  if (message === undefined) return null;
  return (
    <p
      id={id}
      role="alert"
      aria-live="polite"
      className="text-destructive flex items-center gap-1.5 text-sm"
    >
      <XCircle className="size-4" aria-hidden="true" />
      {message}
    </p>
  );
}

function errorAt(errors: FieldErrors, path: string): string | undefined {
  let node: unknown = errors;
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = Reflect.get(node, part);
  }
  if (node === null || typeof node !== 'object') return undefined;
  const message: unknown = Reflect.get(node, 'message');
  return typeof message === 'string' && message !== '' ? message : undefined;
}

function refusalData(error: unknown): unknown {
  return error instanceof AppError ? error.data : undefined;
}

function DispatchEditorDialog({
  onOpenChange,
  organizationId,
  projectId,
  projectKey,
  workersLimit,
  taskTitles,
  settingUp,
}: ProjectDispatchEditorProps) {
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');
  const configuration = useProjectDispatchConfiguration(
    organizationId,
    projectId,
    true,
  );
  const { mutateAsync: saveDispatch } = useSaveProjectDispatch(
    organizationId,
    projectId,
  );

  // The version the editor works on: the first answer read since it opened,
  // never a cached one. It moves only when this editor saves, or when the
  // person loads the version another session saved.
  const [snapshot, setSnapshot] = useState<ProjectDispatchConfiguration>();
  if (
    snapshot === undefined &&
    configuration.data !== undefined &&
    configuration.isFetchedAfterMount
  ) {
    setSnapshot(configuration.data);
  }
  const unreadable =
    backendErrorCode(configuration.error) === 'CONFIG_UNREADABLE';
  const readFailed =
    !unreadable && snapshot === undefined && configuration.isError;

  const data = useMemo(
    () =>
      snapshot === undefined
        ? undefined
        : toFormValues(snapshot.dispatch, { workersLimit }),
    [snapshot, workersLimit],
  );
  const defaultValues = useMemo(
    () => toFormValues(null, { workersLimit }),
    [workersLimit],
  );

  const schema = useMemo(
    () =>
      dispatchFormSchema({
        maxConcurrentRuns: t('dispatch.editor.validation.wholeNumber', {
          min: 1,
          max: DISPATCH_RUNS_MAX,
        }),
        perAgentConcurrency: t('dispatch.editor.validation.wholeNumber', {
          min: 1,
          max: DISPATCH_RUNS_MAX,
        }),
        perAgentAboveRuns: t('dispatch.editor.validation.perAgentAboveRuns'),
        startSpacing: t('dispatch.editor.validation.wholeNumber', {
          min: 0,
          max: 3_600,
        }),
        recheck: t('dispatch.editor.validation.recheck', {
          min: 10,
          max: 3_600,
        }),
        agentsMax: t('dispatch.editor.validation.agentsMax', {
          count: DISPATCH_POOL_MAX,
        }),
        labelsMax: t('dispatch.editor.validation.labelsMax', {
          count: DISPATCH_LABELS_MAX,
        }),
        key: t('dispatch.editor.validation.key'),
        keyTaken: t('dispatch.editor.validation.keyTaken'),
        roleAgent: t('dispatch.editor.validation.roleAgent'),
        roleTask: t('dispatch.editor.validation.roleTask'),
        cronRequired: t('dispatch.editor.validation.cronRequired'),
        cronInvalid: (reason) =>
          t('dispatch.editor.validation.cronInvalid', { reason }),
        timezone: t('dispatch.editor.validation.timezone'),
        mode: t('dispatch.editor.validation.tooLong', {
          count: DISPATCH_ROLE_MODE_MAX,
        }),
        brief: t('dispatch.editor.validation.tooLong', {
          count: DISPATCH_ROLE_BRIEF_MAX,
        }),
        number: t('dispatch.editor.validation.number'),
        recoverWithoutHold: t('dispatch.editor.validation.recoverWithoutHold'),
        recoverAboveHold: t('dispatch.editor.validation.recoverAboveHold'),
        staleAfter: t('dispatch.editor.validation.wholeNumber', {
          min: 60,
          max: 86_400,
        }),
        gateSpacing: t('dispatch.editor.validation.wholeNumber', {
          min: 0,
          max: 86_400,
        }),
      }),
    [t],
  );

  /** The sentence the save toast says for a refusal, in the reader's
   * language where the code has one, else the refusal's own words. */
  const failureSentence = useCallback(
    (error: unknown): string => {
      switch (backendErrorCode(error)) {
        case 'CONFIG_VERSION_CONFLICT':
          return t('dispatch.editor.conflict');
        case 'CONFIG_UNREADABLE':
          return t('dispatch.unreadable.body');
        case 'PROJECT_ARCHIVED':
          return t('errors.PROJECT_ARCHIVED');
        case 'PROJECT_FORBIDDEN':
          return t('dispatch.editor.forbidden');
        default:
          return failureDetail(error) ?? t('dispatch.editor.saveFailed');
      }
    },
    [t],
  );

  // The values the platform refused, so its issues can name a label.
  const submittedRef = useRef<DispatchFormValues | null>(null);

  const save = useCallback(
    async (values: DispatchFormValues) => {
      if (snapshot === undefined) {
        throw new Error(t('dispatch.editor.loadFailed'));
      }
      submittedRef.current = values;
      const dispatch = toDispatch(values, snapshot.dispatch);
      try {
        const saved = await saveDispatch({
          dispatch,
          expectedHash: snapshot.hash,
        });
        setSnapshot({ dispatch, hash: saved.hash });
      } catch (error) {
        // Issues the form can show stay as they came, for `mapServerError`
        // to put under their fields; every other failure becomes the one
        // save toast's sentence.
        if (
          backendErrorCode(error) === 'DISPATCH_INVALID' &&
          dispatchIssuesOf(refusalData(error)).length > 0
        ) {
          throw error;
        }
        console.error('[dispatch] save failed', error);
        const code = backendErrorCode(error);
        if (
          code === 'CONFIG_VERSION_CONFLICT' ||
          code === 'CONFIG_UNREADABLE'
        ) {
          void configuration.refetch();
        }
        throw new Error(failureSentence(error), { cause: error });
      }
      toast({ title: t('dispatch.editor.saved'), variant: 'success' });
      onOpenChange(false);
    },
    [snapshot, saveDispatch, configuration, failureSentence, onOpenChange, t],
  );

  const issueSentence = useCallback(
    (problem: DispatchIssueKind): string => {
      switch (problem.kind) {
        case 'agent':
          return t('dispatch.editor.issues.agent');
        case 'roleAgent':
          return t('dispatch.editor.issues.roleAgent');
        case 'roleTask':
          return t('dispatch.editor.issues.roleTask');
        case 'cron':
          return t('dispatch.editor.issues.cron');
        case 'label':
          return t('dispatch.editor.issues.label', { name: problem.name });
        default:
          return problem.message;
      }
    },
    [t],
  );

  const mapServerError = useCallback(
    (error: unknown) => {
      if (backendErrorCode(error) !== 'DISPATCH_INVALID') return null;
      const issues = dispatchIssuesOf(refusalData(error));
      const values = submittedRef.current;
      if (issues.length === 0 || values === null) return null;
      const byPath = new Map<string, string[]>();
      for (const issue of issues) {
        const placed = placeIssue(issue, values);
        const sentences = byPath.get(placed.path) ?? [];
        const sentence = issueSentence(placed.problem);
        if (!sentences.includes(sentence)) sentences.push(sentence);
        byPath.set(placed.path, sentences);
      }
      return [...byPath].map(([path, sentences]) => ({
        path,
        message: sentences.join(' '),
      }));
    },
    [issueSentence],
  );

  const editor = useFormEditor<DispatchFormValues>({
    data,
    defaultValues,
    schema,
    save,
    mapServerError,
  });

  const latest = configuration.data;
  const changedElsewhere =
    snapshot !== undefined &&
    latest !== undefined &&
    latest.hash !== snapshot.hash &&
    !editor.isSaving;
  const loadCurrent = () => {
    if (latest === undefined) return;
    editor.form.reset(toFormValues(latest.dispatch, { workersLimit }));
    setSnapshot(latest);
  };

  // Until the stored version is read, the page's word decides the title.
  const isNew = snapshot === undefined ? settingUp : snapshot.dispatch === null;
  const editable = snapshot !== undefined && !unreadable;
  const refusedMessage = editor.form.formState.errors.root?.server?.message;

  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title={t(isNew ? 'dispatch.editor.setUpTitle' : 'dispatch.editor.title')}
      description={t('dispatch.editor.description')}
      size="3xl"
      isSubmitting={editor.isSaving}
      // A new dispatch is saved as it stands, defaults and all.
      isDirty={editable && (isNew || editor.isDirty)}
      confirmDiscardOnDirty
      onSubmit={editor.submit}
      {...(editable
        ? {}
        : {
            customFooter: (
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
              >
                {tCommon('actions.close')}
              </Button>
            ),
          })}
    >
      {unreadable ? (
        <Alert
          variant="warning"
          live="off"
          title={t('dispatch.unreadable.title')}
          description={t('dispatch.unreadable.body')}
        />
      ) : readFailed ? (
        <Alert
          variant="destructive"
          title={t('dispatch.editor.loadFailed')}
          description={failureDetail(configuration.error)}
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2"
            isLoading={configuration.isFetching}
            onClick={() => void configuration.refetch()}
          >
            {tCommon('actions.tryAgain')}
          </Button>
        </Alert>
      ) : snapshot === undefined ? (
        <Skeletonize loading label={t('dispatch.editor.title')}>
          <Stack gap={4}>
            {[0, 1, 2, 3, 4].map((index) => (
              <SkeletonText key={index} seed={index} />
            ))}
          </Stack>
        </Skeletonize>
      ) : (
        <Stack gap={6}>
          {changedElsewhere ? (
            <Alert
              variant="warning"
              title={t('dispatch.editor.changedTitle')}
              description={t('dispatch.editor.changedBody')}
            >
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={loadCurrent}
              >
                {t('dispatch.editor.reload')}
              </Button>
            </Alert>
          ) : null}
          {refusedMessage !== undefined ? (
            <Alert
              variant="destructive"
              title={t('dispatch.editor.issues.refusedTitle')}
              description={refusedMessage}
            />
          ) : null}
          <DispatchFields
            control={editor.form.control}
            register={editor.form.register}
            errors={editor.form.formState.errors}
            projectId={projectId}
            projectKey={projectKey}
            workersLimit={workersLimit}
            taskTitles={taskTitles}
            storedAgents={snapshot.dispatch?.agents ?? NO_VALUES}
          />
        </Stack>
      )}
    </FormDialog>
  );
}

interface DispatchFieldsProps {
  control: Control<DispatchFormValues>;
  register: UseFormRegister<DispatchFormValues>;
  errors: FieldErrors<DispatchFormValues>;
  projectId: string;
  projectKey: string | undefined;
  workersLimit: number;
  taskTitles: ReadonlyMap<string, string>;
  /** The pool as stored: an agent that left the project stays listed, so it
   * can be seen and removed. */
  storedAgents: readonly string[];
}

function DispatchFields({
  control,
  register,
  errors,
  projectId,
  projectKey,
  workersLimit,
  taskTitles,
  storedAgents,
}: DispatchFieldsProps) {
  const { t } = useT('projects');
  const { t: tTasks } = useT('tasks');
  const { timezone: viewerZone } = useFormatDate();
  const ids = useId();
  const { agents } = useProjectAgents(projectId);
  const { labels } = useTaskLabels(projectId);
  const { tasks } = useTasksByProject(projectId);

  const agentOptions = useMemo<MultiSelectOption[]>(() => {
    const known = agents.map((agent) => ({
      value: agent._id,
      label: agent.name,
    }));
    const gone = storedAgents
      .filter((id) => !agents.some((agent) => agent._id === id))
      .map((id) => ({ value: id, label: t('dispatch.roles.unknownAgent') }));
    return [...known, ...gone];
  }, [agents, storedAgents, t]);

  const labelOptions = useMemo<MultiSelectOption[]>(
    () => labels.map((label) => ({ value: label.name, label: label.name })),
    [labels],
  );

  const taskOptions = useMemo<SearchableSelectOption[]>(() => {
    const listed = tasks.map((task) => {
      const identifier = formatTaskIdentifier(projectKey, task.number);
      return {
        value: task._id,
        label: task.title,
        ...(identifier !== null ? { description: identifier } : {}),
      };
    });
    const missing = [...taskTitles]
      .filter(([id]) => !tasks.some((task) => task._id === id))
      .map(([id, title]) => ({ value: id, label: title }));
    return [...listed, ...missing];
  }, [tasks, taskTitles, projectKey]);

  const statusOptions = useMemo(() => {
    const todo = tTasks('status.todo');
    const backlog = tTasks('status.backlog');
    return [
      { value: 'todo', label: todo },
      { value: 'backlog', label: backlog },
      {
        value: 'todo,backlog',
        label: t('dispatch.editor.statusesBoth', {
          first: todo,
          second: backlog,
        }),
      },
      {
        value: 'backlog,todo',
        label: t('dispatch.editor.statusesBoth', {
          first: backlog,
          second: todo,
        }),
      },
    ];
  }, [t, tTasks]);

  const agentsError = errorAt(errors, 'agents');
  const includeError = errorAt(errors, 'labels.include');
  const excludeError = errorAt(errors, 'labels.exclude');

  return (
    <>
      <Controller
        control={control}
        name="enabled"
        render={({ field }) => (
          <Switch
            checked={field.value}
            onCheckedChange={field.onChange}
            label={t('dispatch.editor.enabled')}
            description={t('dispatch.editor.enabledHint')}
          />
        )}
      />

      <Stack gap={4}>
        <Controller
          control={control}
          name="agents"
          render={({ field }) => (
            <Stack gap={1}>
              <MultiSelect
                id={`${ids}-agents`}
                label={t('dispatch.editor.agents')}
                description={
                  agents.length === 0
                    ? t('dispatch.editor.noAgents')
                    : t('dispatch.editor.agentsHint')
                }
                value={field.value}
                onValueChange={field.onChange}
                options={agentOptions}
                placeholder={t('dispatch.editor.agentsPlaceholder')}
                searchPlaceholder={t('dispatch.editor.agentsSearch')}
                error={agentsError !== undefined}
                {...(agentsError !== undefined
                  ? { 'aria-describedby': `${ids}-agents-error` }
                  : {})}
                modal
              />
              <SelectError id={`${ids}-agents-error`} message={agentsError} />
            </Stack>
          )}
        />
        <Row gap={4} wrap className="items-start">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={DISPATCH_RUNS_MAX}
            label={t('dispatch.editor.maxConcurrentRuns')}
            description={t('dispatch.editor.maxConcurrentRunsHint', {
              count: workersLimit,
            })}
            errorMessage={errors.maxConcurrentRuns?.message}
            wrapperClassName="min-w-48 flex-1"
            {...register('maxConcurrentRuns')}
          />
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={DISPATCH_RUNS_MAX}
            label={t('dispatch.editor.perAgentConcurrency')}
            description={t('dispatch.editor.perAgentConcurrencyHint')}
            errorMessage={errors.perAgentConcurrency?.message}
            wrapperClassName="min-w-48 flex-1"
            {...register('perAgentConcurrency')}
          />
        </Row>
      </Stack>

      <Stack gap={4}>
        <Row gap={4} wrap className="items-start">
          <Controller
            control={control}
            name="statuses"
            render={({ field }) => (
              <Select
                label={t('dispatch.editor.statuses')}
                value={field.value}
                onValueChange={field.onChange}
                options={statusOptions}
                wrapperClassName="min-w-48 flex-1"
              />
            )}
          />
          <Controller
            control={control}
            name="assignment"
            render={({ field }) => (
              <Select
                label={t('dispatch.editor.assignment')}
                value={field.value}
                onValueChange={field.onChange}
                options={[
                  {
                    value: 'assigned',
                    label: t('dispatch.editor.assignmentAssigned'),
                  },
                  {
                    value: 'pool',
                    label: t('dispatch.editor.assignmentPool'),
                  },
                ]}
                wrapperClassName="min-w-48 flex-1"
              />
            )}
          />
        </Row>
        <Controller
          control={control}
          name="rebalance"
          render={({ field }) => (
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
              label={t('dispatch.editor.rebalance')}
              description={t('dispatch.editor.rebalanceHint')}
            />
          )}
        />
        <Controller
          control={control}
          name="labels.include"
          render={({ field }) => (
            <Stack gap={1}>
              <MultiSelect
                id={`${ids}-include`}
                label={t('dispatch.editor.labelsInclude')}
                value={field.value}
                onValueChange={field.onChange}
                options={withStored(labelOptions, field.value)}
                placeholder={t('dispatch.editor.labelsAny')}
                searchPlaceholder={t('dispatch.editor.labelsSearch')}
                error={includeError !== undefined}
                {...(includeError !== undefined
                  ? { 'aria-describedby': `${ids}-include-error` }
                  : {})}
                modal
              />
              <SelectError id={`${ids}-include-error`} message={includeError} />
            </Stack>
          )}
        />
        <Controller
          control={control}
          name="labels.exclude"
          render={({ field }) => (
            <Stack gap={1}>
              <MultiSelect
                id={`${ids}-exclude`}
                label={t('dispatch.editor.labelsExclude')}
                value={field.value}
                onValueChange={field.onChange}
                options={withStored(labelOptions, field.value)}
                placeholder={t('dispatch.editor.labelsNone')}
                searchPlaceholder={t('dispatch.editor.labelsSearch')}
                error={excludeError !== undefined}
                {...(excludeError !== undefined
                  ? { 'aria-describedby': `${ids}-exclude-error` }
                  : {})}
                modal
              />
              <SelectError id={`${ids}-exclude-error`} message={excludeError} />
            </Stack>
          )}
        />
      </Stack>

      <Stack gap={4}>
        <Controller
          control={control}
          name="admission.preset"
          render={({ field }) => (
            <Select
              label={t('dispatch.editor.preset')}
              value={field.value}
              onValueChange={field.onChange}
              options={[
                { value: 'default', label: t('dispatch.editor.presetDefault') },
                {
                  value: 'conservative',
                  label: t('dispatch.editor.presetConservative'),
                },
              ]}
              hint={t('dispatch.editor.presetHint')}
            />
          )}
        />
        <Row gap={4} wrap className="items-start">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={3_600}
            label={t('dispatch.editor.startSpacing')}
            errorMessage={errors.admission?.startSpacingSeconds?.message}
            wrapperClassName="min-w-48 flex-1"
            {...register('admission.startSpacingSeconds')}
          />
          <Input
            label={t('dispatch.editor.recheck')}
            description={t('dispatch.editor.recheckHint')}
            errorMessage={errors.admission?.recheckSeconds?.message}
            wrapperClassName="min-w-48 flex-1"
            {...register('admission.recheckSeconds')}
          />
        </Row>
      </Stack>

      <StandingRoles
        control={control}
        register={register}
        errors={errors}
        agentOptions={agentOptions}
        taskOptions={taskOptions}
        viewerZone={viewerZone}
      />

      <Gates
        control={control}
        register={register}
        errors={errors}
        labelOptions={labelOptions}
      />
    </>
  );
}

/** The options of a label picker with every label the document names, so
 * a label the project no longer has stays visible and removable. */
function withStored(
  options: MultiSelectOption[],
  selected: readonly string[],
): MultiSelectOption[] {
  const missing = selected.filter(
    (name) => !options.some((option) => option.value === name),
  );
  return missing.length === 0
    ? options
    : [...options, ...missing.map((name) => ({ value: name, label: name }))];
}

function StandingRoles({
  control,
  register,
  errors,
  agentOptions,
  taskOptions,
  viewerZone,
}: {
  control: Control<DispatchFormValues>;
  register: UseFormRegister<DispatchFormValues>;
  errors: FieldErrors<DispatchFormValues>;
  agentOptions: MultiSelectOption[];
  taskOptions: SearchableSelectOption[];
  viewerZone: string;
}) {
  const { t } = useT('projects');
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'standingRoles',
  });
  const atLimit = fields.length >= DISPATCH_STANDING_ROLES_MAX;
  return (
    <FormSection
      label={t('dispatch.editor.roles.title')}
      description={t('dispatch.editor.roles.description')}
    >
      {fields.map((field, index) => (
        <RoleFields
          key={field.id}
          index={index}
          control={control}
          register={register}
          errors={errors}
          agentOptions={agentOptions}
          taskOptions={taskOptions}
          viewerZone={viewerZone}
          onRemove={() => remove(index)}
        />
      ))}
      <Row gap={3} align="center" wrap>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={Plus}
          disabled={atLimit}
          onClick={() => append(emptyRole(viewerZone || 'UTC'))}
        >
          {t('dispatch.editor.roles.add')}
        </Button>
        {atLimit ? (
          <Text variant="caption" className="text-muted-foreground">
            {t('dispatch.editor.roles.limit', {
              count: DISPATCH_STANDING_ROLES_MAX,
            })}
          </Text>
        ) : null}
      </Row>
    </FormSection>
  );
}

function RoleFields({
  index,
  control,
  register,
  errors,
  agentOptions,
  taskOptions,
  viewerZone,
  onRemove,
}: {
  index: number;
  control: Control<DispatchFormValues>;
  register: UseFormRegister<DispatchFormValues>;
  errors: FieldErrors<DispatchFormValues>;
  agentOptions: MultiSelectOption[];
  taskOptions: SearchableSelectOption[];
  viewerZone: string;
  onRemove: () => void;
}) {
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');
  const ids = useId();
  const key = useWatch({ control, name: `standingRoles.${index}.key` });
  const roleErrors = errors.standingRoles?.[index];
  const taskError = roleErrors?.taskId?.message;
  const zoneError = roleErrors?.timezone?.message;
  const title = key.trim() === '' ? t('dispatch.editor.roles.untitled') : key;
  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border p-4">
      <legend className="sr-only">{title}</legend>
      <Row justify="between" align="center" gap={2}>
        <Text className="truncate font-medium" aria-hidden="true">
          {title}
        </Text>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={Trash2}
          aria-label={t('dispatch.editor.roles.removeAria', { key: title })}
          onClick={onRemove}
        >
          {t('dispatch.editor.remove')}
        </Button>
      </Row>
      <Row gap={4} wrap className="items-start">
        <Input
          label={t('dispatch.editor.roles.key')}
          description={t('dispatch.editor.roles.keyHint')}
          errorMessage={roleErrors?.key?.message}
          autoComplete="off"
          spellCheck={false}
          wrapperClassName="min-w-48 flex-1"
          {...register(`standingRoles.${index}.key`)}
        />
        <Controller
          control={control}
          name={`standingRoles.${index}.agentId`}
          render={({ field }) => (
            <Select
              label={t('dispatch.editor.roles.agent')}
              value={field.value}
              onValueChange={field.onChange}
              options={agentOptions}
              placeholder={t('dispatch.editor.roles.agentPlaceholder')}
              errorMessage={roleErrors?.agentId?.message}
              wrapperClassName="min-w-48 flex-1"
            />
          )}
        />
      </Row>
      <Controller
        control={control}
        name={`standingRoles.${index}.taskId`}
        render={({ field }) => (
          <Stack gap={1}>
            <SearchableSelect
              id={`${ids}-task`}
              label={t('dispatch.editor.roles.task')}
              value={field.value === '' ? null : field.value}
              onValueChange={field.onChange}
              options={taskOptions}
              placeholder={t('dispatch.editor.roles.taskPlaceholder')}
              searchPlaceholder={t('dispatch.editor.roles.taskSearch')}
              emptyText={tCommon('search.noResults')}
              error={taskError !== undefined}
              modal
            />
            <SelectError id={`${ids}-task-error`} message={taskError} />
          </Stack>
        )}
      />
      <Row gap={4} wrap className="items-start">
        <Input
          label={t('dispatch.editor.roles.cron')}
          description={t('dispatch.editor.roles.cronHint')}
          errorMessage={roleErrors?.cron?.message}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          wrapperClassName="min-w-48 flex-1"
          {...register(`standingRoles.${index}.cron`)}
        />
        <Controller
          control={control}
          name={`standingRoles.${index}.timezone`}
          render={({ field }) => (
            <Stack gap={1} className="min-w-48 flex-1">
              <SearchableSelect
                id={`${ids}-zone`}
                label={t('dispatch.editor.roles.timezone')}
                value={field.value === '' ? null : field.value}
                onValueChange={field.onChange}
                options={listTimezoneOptions(field.value, viewerZone).map(
                  (zone) => ({ value: zone, label: zone }),
                )}
                searchPlaceholder={t('dispatch.editor.roles.timezoneSearch')}
                emptyText={tCommon('search.noResults')}
                error={zoneError !== undefined}
                modal
              />
              <SelectError id={`${ids}-zone-error`} message={zoneError} />
            </Stack>
          )}
        />
      </Row>
      <Input
        label={t('dispatch.editor.roles.mode')}
        description={t('dispatch.editor.roles.modeHint')}
        errorMessage={roleErrors?.mode?.message}
        autoComplete="off"
        {...register(`standingRoles.${index}.mode`)}
      />
      <Textarea
        label={t('dispatch.editor.roles.brief')}
        description={t('dispatch.editor.roles.briefHint')}
        errorMessage={roleErrors?.brief?.message}
        rows={3}
        {...register(`standingRoles.${index}.brief`)}
      />
    </fieldset>
  );
}

function Gates({
  control,
  register,
  errors,
  labelOptions,
}: {
  control: Control<DispatchFormValues>;
  register: UseFormRegister<DispatchFormValues>;
  errors: FieldErrors<DispatchFormValues>;
  labelOptions: MultiSelectOption[];
}) {
  const { t } = useT('projects');
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'gates',
  });
  const atLimit = fields.length >= DISPATCH_GATES_MAX;
  return (
    <FormSection
      label={t('dispatch.editor.gates.title')}
      description={t('dispatch.editor.gates.description')}
    >
      {fields.map((field, index) => (
        <GateFields
          key={field.id}
          index={index}
          control={control}
          register={register}
          errors={errors}
          labelOptions={labelOptions}
          onRemove={() => remove(index)}
        />
      ))}
      <Row gap={3} align="center" wrap>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={Plus}
          disabled={atLimit}
          onClick={() => append(emptyGate())}
        >
          {t('dispatch.editor.gates.add')}
        </Button>
        {atLimit ? (
          <Text variant="caption" className="text-muted-foreground">
            {t('dispatch.editor.gates.limit', { count: DISPATCH_GATES_MAX })}
          </Text>
        ) : null}
      </Row>
    </FormSection>
  );
}

function GateFields({
  index,
  control,
  register,
  errors,
  labelOptions,
  onRemove,
}: {
  index: number;
  control: Control<DispatchFormValues>;
  register: UseFormRegister<DispatchFormValues>;
  errors: FieldErrors<DispatchFormValues>;
  labelOptions: MultiSelectOption[];
  onRemove: () => void;
}) {
  const { t } = useT('projects');
  const ids = useId();
  const key = useWatch({ control, name: `gates.${index}.key` });
  const gateErrors = errors.gates?.[index];
  const labelsError = errorAt(errors, `gates.${index}.labels`);
  const title = key.trim() === '' ? t('dispatch.editor.gates.untitled') : key;
  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border p-4">
      <legend className="sr-only">{title}</legend>
      <Row justify="between" align="center" gap={2}>
        <Text className="truncate font-medium" aria-hidden="true">
          {title}
        </Text>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={Trash2}
          aria-label={t('dispatch.editor.gates.removeAria', { key: title })}
          onClick={onRemove}
        >
          {t('dispatch.editor.remove')}
        </Button>
      </Row>
      <Input
        label={t('dispatch.editor.gates.key')}
        description={t('dispatch.editor.roles.keyHint')}
        errorMessage={gateErrors?.key?.message}
        autoComplete="off"
        spellCheck={false}
        {...register(`gates.${index}.key`)}
      />
      <Controller
        control={control}
        name={`gates.${index}.labels`}
        render={({ field }) => (
          <Stack gap={1}>
            <MultiSelect
              id={`${ids}-labels`}
              label={t('dispatch.editor.gates.labels')}
              description={t('dispatch.editor.gates.labelsHint')}
              value={field.value}
              onValueChange={field.onChange}
              options={withStored(labelOptions, field.value)}
              placeholder={t('dispatch.editor.gates.labelsPlaceholder')}
              searchPlaceholder={t('dispatch.editor.labelsSearch')}
              error={labelsError !== undefined}
              {...(labelsError !== undefined
                ? { 'aria-describedby': `${ids}-labels-error` }
                : {})}
              modal
            />
            <SelectError id={`${ids}-labels-error`} message={labelsError} />
          </Stack>
        )}
      />
      <Row gap={4} wrap className="items-start">
        <Input
          type="number"
          step="any"
          label={t('dispatch.editor.gates.holdAt')}
          description={t('dispatch.editor.gates.holdAtHint')}
          errorMessage={gateErrors?.holdAt?.message}
          wrapperClassName="min-w-48 flex-1"
          {...register(`gates.${index}.holdAt`)}
        />
        <Input
          type="number"
          step="any"
          label={t('dispatch.editor.gates.recoverBelow')}
          description={t('dispatch.editor.gates.recoverBelowHint')}
          errorMessage={gateErrors?.recoverBelow?.message}
          wrapperClassName="min-w-48 flex-1"
          {...register(`gates.${index}.recoverBelow`)}
        />
      </Row>
      <Row gap={4} wrap className="items-start">
        <Input
          type="number"
          inputMode="numeric"
          min={60}
          max={86_400}
          label={t('dispatch.editor.gates.staleAfter')}
          description={t('dispatch.editor.gates.staleAfterHint')}
          errorMessage={gateErrors?.staleAfterSeconds?.message}
          wrapperClassName="min-w-48 flex-1"
          {...register(`gates.${index}.staleAfterSeconds`)}
        />
        <Controller
          control={control}
          name={`gates.${index}.whenStale`}
          render={({ field }) => (
            <Select
              label={t('dispatch.editor.gates.whenStale')}
              value={field.value}
              onValueChange={field.onChange}
              options={[
                { value: 'open', label: t('dispatch.gates.open') },
                { value: 'hold', label: t('dispatch.gates.hold') },
              ]}
              wrapperClassName="min-w-48 flex-1"
            />
          )}
        />
      </Row>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={86_400}
        label={t('dispatch.editor.gates.startSpacing')}
        errorMessage={gateErrors?.startSpacingSeconds?.message}
        {...register(`gates.${index}.startSpacingSeconds`)}
      />
    </fieldset>
  );
}
