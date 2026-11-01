'use client';

import { Alert } from '@tale/ui/alert';
import { Checkbox } from '@tale/ui/checkbox';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import { NumberStepper } from '@tale/ui/number-stepper';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { Select } from '@tale/ui/select';
import { Switch } from '@tale/ui/switch';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { toast } from '@tale/ui/use-toast';
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useProjects } from '@/app/features/projects/hooks/queries';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { cronParseProblem } from '@/lib/automations/cron';
import { generatedAutomationSlug, slugFromName } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';
import { localTimeZone } from '@/lib/shared/zoned-time';

import { mergeNodeTypes } from '../hooks/backend';
import { useCreateAutomationFromTemplate } from '../hooks/mutations';
import { useNodeTypeCatalog } from '../hooks/queries';
import {
  automationAnswerIssues,
  automationErrorCode,
  automationErrorMessage,
} from '../lib/errors';
import { connectorName, nodeCatalogView } from '../lib/node-face';
import {
  type FormAnswer,
  fieldWords,
  initialAnswers,
  missingConnectors,
  optionLabel,
  type TemplateDetail,
  type TemplateField,
  templateWords,
  unansweredFields,
  wireAnswers,
} from '../lib/templates';
import {
  defaultTriggerDraft,
  type TriggerDraft,
  triggerDraftIssue,
} from '../lib/trigger-draft';
import { triggerIssueText } from '../lib/trigger-issue-text';
import { TriggerScheduleField } from './trigger-schedule-field';

/** The value the select gives an optional credential question's empty
 * choice — a select item cannot carry the empty string its answer is. A
 * credential is named by a person, so the value uses a character no name is
 * typed with. */
const EMPTY_CHOICE = '\u2063empty';

/** How long after the questions open an Enter in their Name field is taken
 * as the second press of the double Enter that opened them — about a double
 * click's time — and never creates. */
const SETTLE_MS = 500;

/** What a create from a template made: where to open it, whether it
 * started, and the webhook token it minted, shown once. */
export interface TemplateCreated {
  name: string;
  deployed: boolean;
  projectId?: string;
  token?: string;
}

/** The form of one template: its answers, its name, and the create. */
export interface TemplateSetup {
  formId: string;
  name: string;
  setName: (name: string) => void;
  nameError: string | undefined;
  slug: string;
  answers: Readonly<Record<string, FormAnswer>>;
  setAnswer: (field: string, value: FormAnswer) => void;
  schedule: TriggerDraft | null;
  patchSchedule: (patch: Partial<TriggerDraft>) => void;
  viewerZone: string;
  startNow: boolean;
  setStartNow: (on: boolean) => void;
  /** Every connector the template needs is connected: it can start. */
  canStart: boolean;
  /** Every question can be answered: it can at least be created as a draft.
   * A required credential question whose connector has no credential in
   * service cannot be. */
  canDraft: boolean;
  /** The connectors it needs that are not connected, by name. */
  missingNames: string;
  /** The connectors a required credential question waits for, by name. */
  blockedNames: string;
  /** The number questions whose typed number is out of range — shown as
   * typed, never corrected, and holding the create until fixed. */
  outOfRange: readonly string[];
  setOutOfRange: (field: string, out: boolean) => void;
  fieldErrors: Readonly<Record<string, string>>;
  submitting: boolean;
  canSubmit: boolean;
  disabledReason: string | undefined;
  submit: () => void;
}

/** What one template's form holds while the reader answers it. */
interface TemplateForm {
  /** The template the form answers. */
  slug: string;
  name: string;
  nameError: string | undefined;
  /** The name a typed name with nothing to keep gets (`发票提醒`). */
  generatedSlug: string;
  answers: Record<string, FormAnswer>;
  /** A schedule question's answer, as the schedule field's draft. */
  schedule: TriggerDraft | null;
  startNow: boolean;
  outOfRange: readonly string[];
  fieldErrors: Record<string, string>;
}

/** A template's form as it opens: the template's name in the reader's
 * language, the defaults its questions offer, its own schedule in the
 * reader's zone, and "Start it now" on when it can start. */
function startForm(
  template: TemplateDetail,
  options: { locale: string; viewerZone: string; projectId?: string },
): TemplateForm {
  const draft = defaultTriggerDraft(options.viewerZone);
  const trigger = template.trigger;
  const schedule =
    trigger?.kind !== 'schedule'
      ? draft
      : trigger.repeat !== null
        ? { ...draft, repeat: trigger.repeat }
        : trigger.cron !== null
          ? { ...draft, scheduleFormat: 'cron' as const, cron: trigger.cron }
          : draft;
  return {
    slug: template.slug,
    name: templateWords(template, options.locale).name,
    nameError: undefined,
    generatedSlug: generatedAutomationSlug(),
    answers: initialAnswers(template, {
      locale: options.locale,
      credentials: template.credentials,
      ...(options.projectId !== undefined && { projectId: options.projectId }),
    }),
    schedule: template.fields.some((field) => field.kind === 'schedule')
      ? schedule
      : null,
    startNow: missingConnectors(template).length === 0,
    outOfRange: [],
    fieldErrors: {},
  };
}

/**
 * The form of the template picked — kept by the catalog dialog, whose
 * footer holds the Create button — and the create itself: one call, in
 * which the server writes the answers into the template's document and
 * saves version 1, deploys it and turns its trigger on when "Start it now"
 * is — all of it or none. A refusal comes back to the questions it names.
 * Null while no template is open. The answers live as long as the template
 * stays open — through its preview and back — and another template starts
 * from its own.
 */
export function useTemplateSetup({
  organizationId,
  template,
  projectId,
  locale,
  onCreated,
}: {
  organizationId: string;
  template: TemplateDetail | null;
  /** The project the catalog was opened in: its project question starts
   * there. */
  projectId?: string;
  locale: string;
  onCreated: (created: TemplateCreated) => void;
}): TemplateSetup | null {
  const { t } = useT('automations');
  const { t: tRecurrence } = useT('recurrence');
  const formId = useId();
  const create = useCreateAutomationFromTemplate();
  const catalogQuery = useNodeTypeCatalog(organizationId);
  const catalog = useMemo(
    () =>
      nodeCatalogView(
        mergeNodeTypes(catalogQuery.data?.nodeTypes),
        catalogQuery.data?.connectors ?? [],
      ),
    [catalogQuery.data],
  );
  const [viewerZone] = useState(localTimeZone);
  const [form, setForm] = useState<TemplateForm | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A synchronous latch: a fast double Enter could fire the create twice
  // before `submitting` disables the button.
  const creatingRef = useRef(false);

  // The form follows the template open, reset in the render that opens it.
  if (template === null ? form !== null : form?.slug !== template.slug) {
    setForm(
      template === null
        ? null
        : startForm(template, {
            locale,
            viewerZone,
            ...(projectId !== undefined && { projectId }),
          }),
    );
  }
  if (template === null || form === null || form.slug !== template.slug) {
    return null;
  }

  const update = (patch: (current: TemplateForm) => Partial<TemplateForm>) =>
    setForm((current) =>
      current === null ? current : { ...current, ...patch(current) },
    );
  const { name, answers, schedule } = form;
  const typedSlug = slugFromName(name);
  const slug =
    name.trim() === '' ? '' : typedSlug === '' ? form.generatedSlug : typedSlug;
  const unanswered = unansweredFields(template.fields, answers);
  const scheduleIssue = schedule === null ? null : triggerDraftIssue(schedule);
  const connectorList = (slugs: readonly string[]): string =>
    new Intl.ListFormat(locale, { type: 'conjunction' }).format(
      slugs.map((connector) => connectorName(connector, catalog, locale)),
    );
  const missing = missingConnectors(template);
  const canStart = missing.length === 0;
  const blocked = [
    ...new Set(
      template.fields.flatMap((field) =>
        field.kind === 'credential' &&
        field.required !== false &&
        (template.credentials[field.connector] ?? []).length === 0
          ? [field.connector]
          : [],
      ),
    ),
  ];
  const canDraft = blocked.length === 0;
  const firstOutOfRange = template.fields.find(
    (field): field is Extract<TemplateField, { kind: 'number' }> =>
      field.kind === 'number' && form.outOfRange.includes(field.id),
  );
  const canSubmit =
    canDraft &&
    slug !== '' &&
    firstOutOfRange === undefined &&
    unanswered.length === 0 &&
    scheduleIssue === null;
  const disabledReason = !canDraft
    ? t('templates.needsConnectionToCreate', {
        connectors: connectorList(blocked),
      })
    : slug === ''
      ? t('templates.nameRequired')
      : firstOutOfRange !== undefined
        ? t('templates.numberOutOfRange', {
            label: fieldWords(firstOutOfRange, locale).label,
            min: firstOutOfRange.min,
            max: firstOutOfRange.max,
          })
        : unanswered.length > 0
          ? t('templates.answerEveryQuestion')
          : scheduleIssue !== null && schedule !== null
            ? triggerIssueText(
                scheduleIssue,
                { t, tRecurrence, locale },
                { cronProblem: cronParseProblem(schedule.cron) },
              )
            : undefined;
  const scheduleField = template.fields.find(
    (field) => field.kind === 'schedule',
  );

  const fieldError = (field: TemplateField, code: string): string => {
    if (code === 'required') return t('templates.errors.required');
    if (code === 'too_long') {
      return field.kind === 'list'
        ? t('templates.errors.listTooLong', {
            count: field.maxItems ?? 20,
          })
        : t('templates.errors.tooLong');
    }
    if (code === 'unknown') {
      if (field.kind === 'project') return t('templates.errors.unknownProject');
      if (field.kind === 'member') return t('templates.errors.unknownMember');
      if (field.kind === 'credential') {
        return t('templates.errors.unknownCredential');
      }
    }
    switch (field.kind) {
      case 'schedule':
        return t('templates.errors.schedule');
      case 'choice':
        return t('templates.errors.choice');
      case 'number':
        return t('templates.errors.number', { min: field.min, max: field.max });
      case 'text':
        return field.pattern === undefined
          ? t('templates.errors.invalid')
          : t('templates.errors.form');
      default:
        return t('templates.errors.invalid');
    }
  };

  const doCreate = async (): Promise<void> => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setSubmitting(true);
    const scheduleAnswer =
      schedule === null || scheduleField === undefined
        ? {}
        : {
            [scheduleField.id]: {
              ...(schedule.scheduleFormat === 'cron'
                ? { cron: schedule.cron.trim() }
                : { repeat: schedule.repeat }),
              timezone: schedule.timezone,
              catchUp: schedule.catchUp,
            },
          };
    try {
      const created = await create.mutateAsync({
        organizationId,
        slug: template.slug,
        name: slug,
        // The display name as typed; the slug only addresses it.
        displayName: name.trim(),
        answers: {
          ...wireAnswers(template.fields, answers),
          ...scheduleAnswer,
        },
        locale,
        timezone: viewerZone,
        start: form.startNow && canStart,
      });
      const project = template.fields.find((field) => field.kind === 'project');
      const installedIn = project === undefined ? '' : answers[project.id];
      creatingRef.current = false;
      setSubmitting(false);
      onCreated({
        name: created.name,
        deployed: created.deployed,
        ...(typeof installedIn === 'string' &&
          installedIn !== '' && { projectId: installedIn }),
        ...(created.trigger?.token !== undefined && {
          token: created.trigger.token,
        }),
      });
    } catch (error) {
      const code = automationErrorCode(error);
      if (code === 'AUTOMATION_NAME_TAKEN') {
        update(() => ({ nameError: t('blank.nameTaken') }));
      } else if (code === 'AUTOMATION_NAME_RESERVED') {
        update(() => ({ nameError: t('blank.nameReserved') }));
      } else {
        const errors: Record<string, string> = {};
        for (const issue of automationAnswerIssues(error) ?? []) {
          const field = template.fields.find(
            (entry) => entry.id === issue.field,
          );
          if (field !== undefined) {
            errors[field.id] = fieldError(field, issue.code);
          }
        }
        if (Object.keys(errors).length > 0) {
          update(() => ({ fieldErrors: errors }));
        } else {
          toast({
            title: t('templates.createFailed', {
              error: automationErrorMessage(error),
            }),
            variant: 'destructive',
          });
        }
      }
      creatingRef.current = false;
      setSubmitting(false);
    }
  };

  const withoutError = (
    current: TemplateForm,
    field: string | undefined,
  ): Record<string, string> => {
    if (field === undefined) return current.fieldErrors;
    const { [field]: _gone, ...rest } = current.fieldErrors;
    return rest;
  };

  return {
    formId,
    name,
    setName: (next) => update(() => ({ name: next, nameError: undefined })),
    nameError: form.nameError,
    slug,
    answers,
    setAnswer: (field, value) =>
      update((current) => ({
        answers: { ...current.answers, [field]: value },
        fieldErrors: withoutError(current, field),
      })),
    schedule,
    patchSchedule: (patch) =>
      update((current) => ({
        schedule:
          current.schedule === null
            ? current.schedule
            : { ...current.schedule, ...patch },
        fieldErrors: withoutError(current, scheduleField?.id),
      })),
    viewerZone,
    startNow: form.startNow && canStart,
    setStartNow: (on) => update(() => ({ startNow: on })),
    canStart,
    canDraft,
    missingNames: connectorList(missing),
    blockedNames: connectorList(blocked),
    outOfRange: form.outOfRange,
    setOutOfRange: (field, out) =>
      setForm((current) => {
        if (current === null || current.outOfRange.includes(field) === out) {
          return current;
        }
        const rest = current.outOfRange.filter((entry) => entry !== field);
        return {
          ...current,
          outOfRange: out ? [...rest, field] : rest,
          fieldErrors: withoutError(current, field),
        };
      }),
    fieldErrors: form.fieldErrors,
    submitting,
    canSubmit,
    disabledReason,
    submit: () => {
      if (!canSubmit || submitting) return;
      void doCreate();
    },
  };
}

/** The template's questions, its name and "Start it now". */
export function TemplateSetupFields({
  organizationId,
  template,
  setup,
  locale,
}: {
  organizationId: string;
  template: TemplateDetail;
  setup: TemplateSetup;
  locale: string;
}) {
  const { t } = useT('automations');
  const catalogQuery = useNodeTypeCatalog(organizationId);
  const catalog = useMemo(
    () =>
      nodeCatalogView(
        mergeNodeTypes(catalogQuery.data?.nodeTypes),
        catalogQuery.data?.connectors ?? [],
      ),
    [catalogQuery.data],
  );
  const nameId = `${setup.formId}-name`;
  // When the questions opened: an Enter in the Name field this soon after
  // is the tail of the double press that opened them.
  const openedAt = useRef(0);

  useEffect(() => {
    openedAt.current = Date.now();
    // The questions open ready to type in the Name field, as a form dialog
    // does — except on a touch screen, where focusing a field raises the
    // keyboard unasked.
    const coarse =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
    if (!coarse) {
      document.getElementById(nameId)?.focus({ preventScroll: true });
    }
  }, [nameId]);

  return (
    <form
      id={setup.formId}
      onSubmit={(event) => {
        event.preventDefault();
        setup.submit();
      }}
    >
      <Stack gap={4}>
        {!setup.canStart && (
          <Alert
            variant="warning"
            title={
              setup.canDraft
                ? t('templates.needsConnection', {
                    connectors: setup.missingNames,
                  })
                : t('templates.needsConnectionToCreate', {
                    connectors: setup.blockedNames,
                  })
            }
            description={
              <Link
                to="/dashboard/$id/settings/connectors"
                params={{ id: organizationId }}
                className="text-foreground underline underline-offset-4"
              >
                {t('templates.connectInSettings')}
              </Link>
            }
          />
        )}
        <Input
          id={nameId}
          label={t('blank.nameLabel')}
          value={setup.name}
          onChange={(event) => setup.setName(event.target.value)}
          onKeyDown={(event) => {
            // The second press of a double Enter on "Use this template"
            // lands here, where Enter would create it with every default.
            if (
              event.key === 'Enter' &&
              Date.now() - openedAt.current < SETTLE_MS
            ) {
              event.preventDefault();
            }
          }}
          errorMessage={setup.nameError}
          required
          {...(setup.slug !== '' && setup.slug !== setup.name.trim()
            ? { description: t('blank.slugHint', { slug: setup.slug }) }
            : {})}
        />
        {template.fields.map((field) => (
          <TemplateQuestion
            key={field.id}
            organizationId={organizationId}
            field={field}
            credentials={
              field.kind === 'credential'
                ? (template.credentials[field.connector] ?? [])
                : []
            }
            connector={
              field.kind === 'credential'
                ? connectorName(field.connector, catalog, locale)
                : ''
            }
            setup={setup}
            locale={locale}
          />
        ))}
        <Checkbox
          id={`${setup.formId}-start`}
          label={t('templates.startNow')}
          description={
            setup.canStart
              ? t('templates.startNowHint')
              : setup.canDraft
                ? `${t('templates.startNowNeedsConnection', {
                    connectors: setup.missingNames,
                  })} ${t('templates.startLater')}`
                : t('templates.startNowNeedsConnection', {
                    connectors: setup.missingNames,
                  })
          }
          checked={setup.startNow}
          disabled={!setup.canStart}
          onCheckedChange={(checked) => setup.setStartNow(checked === true)}
        />
      </Stack>
    </form>
  );
}

function TemplateQuestion({
  organizationId,
  field,
  credentials,
  connector,
  setup,
  locale,
}: {
  organizationId: string;
  field: TemplateField;
  /** The credentials in service a credential question offers. */
  credentials: readonly { name: string }[];
  /** A credential question's connector, by name. */
  connector: string;
  setup: TemplateSetup;
  locale: string;
}) {
  const { t } = useT('automations');
  const words = fieldWords(field, locale);
  const id = `${setup.formId}-${field.id}`;
  const error = setup.fieldErrors[field.id];
  const answer = setup.answers[field.id];
  const text = typeof answer === 'string' ? answer : '';
  const picked = (next: FormAnswer) => setup.setAnswer(field.id, next);
  const errorProps =
    error === undefined
      ? words.description === undefined
        ? {}
        : { description: words.description }
      : { error: true, description: error };

  switch (field.kind) {
    case 'project':
      return (
        <ProjectQuestion
          organizationId={organizationId}
          id={id}
          label={words.label}
          value={text}
          onChange={picked}
          {...errorProps}
        />
      );
    case 'member':
      return (
        <MemberQuestion
          organizationId={organizationId}
          id={id}
          label={words.label}
          value={text}
          onChange={picked}
          {...errorProps}
        />
      );
    case 'choice':
      return (
        <Select
          id={id}
          label={words.label}
          {...(words.description !== undefined && {
            description: words.description,
          })}
          {...(error !== undefined && { errorMessage: error })}
          options={field.options.map((option) => ({
            value: option.value,
            label: optionLabel(option, locale),
          }))}
          value={text}
          onValueChange={picked}
          placeholder={t('templates.choicePlaceholder')}
          required
        />
      );
    case 'schedule':
      return setup.schedule === null ? null : (
        <section aria-labelledby={`${id}-label`}>
          <Text as="h3" id={`${id}-label`} className="mb-1 text-sm font-medium">
            {words.label}
          </Text>
          {words.description !== undefined && (
            <Text as="p" variant="muted" className="mb-2 text-xs">
              {words.description}
            </Text>
          )}
          <TriggerScheduleField
            surface="wizard"
            draft={setup.schedule}
            stored={null}
            canEdit
            viewerZone={setup.viewerZone}
            enabled={setup.startNow}
            runState={{ clean: false, deployed: false, nextRunAt: null }}
            onChange={setup.patchSchedule}
            fieldId={id}
          />
          {error !== undefined && (
            <Text as="p" role="alert" className="text-destructive mt-1 text-xs">
              {error}
            </Text>
          )}
        </section>
      );
    case 'credential': {
      // An optional question's empty choice comes first, named for what it
      // means here, so a person can always go back to it.
      const optional = field.required === false;
      const emptyChoice = words.placeholder ?? t('templates.credentialDefault');
      return (
        <Select
          id={id}
          label={words.label}
          {...(words.description !== undefined && {
            description: words.description,
          })}
          {...(error !== undefined && { errorMessage: error })}
          options={[
            ...(optional ? [{ value: EMPTY_CHOICE, label: emptyChoice }] : []),
            ...credentials.map((credential) => ({
              value: credential.name,
              label: credential.name,
            })),
          ]}
          value={optional && text === '' ? EMPTY_CHOICE : text}
          onValueChange={(next) => picked(next === EMPTY_CHOICE ? '' : next)}
          placeholder={t('templates.credentialPlaceholder')}
          emptyHint={t('templates.noCredential', { connector })}
          {...(credentials.length === 0 && {
            hint: (
              <Link
                to="/dashboard/$id/settings/connectors"
                params={{ id: organizationId }}
                className="text-foreground underline underline-offset-4"
              >
                {t('templates.connectInSettings')}
              </Link>
            ),
          })}
          {...(!optional && { required: true })}
        />
      );
    }
    case 'number': {
      // A number typed out of range stays as typed, and says so.
      const numberError =
        error ??
        (setup.outOfRange.includes(field.id)
          ? t('templates.errors.number', { min: field.min, max: field.max })
          : undefined);
      return (
        <Field
          label={words.label}
          htmlFor={id}
          {...(numberError !== undefined
            ? { error: numberError }
            : {
                description:
                  words.description === undefined
                    ? t('templates.numberRange', {
                        min: field.min,
                        max: field.max,
                      })
                    : `${words.description} ${t('templates.numberRange', {
                        min: field.min,
                        max: field.max,
                      })}`,
              })}
        >
          <NumberStepper
            id={id}
            value={typeof answer === 'number' ? answer : field.min}
            min={field.min}
            max={field.max}
            onValueChange={picked}
            onOutOfRange={(typed) =>
              setup.setOutOfRange(field.id, typed !== null)
            }
            decrementLabel={t('templates.decrease', { label: words.label })}
            incrementLabel={t('templates.increase', { label: words.label })}
          />
        </Field>
      );
    }
    case 'toggle':
      return (
        <Switch
          id={id}
          label={words.label}
          {...(words.description !== undefined && {
            description: words.description,
          })}
          checked={answer === true}
          onCheckedChange={picked}
        />
      );
    case 'list':
      return (
        <Textarea
          id={id}
          label={words.label}
          value={text}
          onChange={(event) => picked(event.target.value)}
          rows={3}
          {...(words.placeholder !== undefined && {
            placeholder: words.placeholder,
          })}
          {...(field.required === true && { required: true })}
          description={[words.description, t('templates.onePerLine')]
            .filter((part) => part !== undefined)
            .join(' ')}
          {...(error !== undefined && { errorMessage: error })}
        />
      );
    case 'text':
      return field.multiline === true ? (
        <Textarea
          id={id}
          label={words.label}
          value={text}
          onChange={(event) => picked(event.target.value)}
          rows={3}
          {...(field.maxLength !== undefined && { maxLength: field.maxLength })}
          {...(words.placeholder !== undefined && {
            placeholder: words.placeholder,
          })}
          {...(field.required !== false && { required: true })}
          {...(words.description !== undefined && {
            description: words.description,
          })}
          {...(error !== undefined && { errorMessage: error })}
        />
      ) : (
        <Input
          id={id}
          label={words.label}
          value={text}
          onChange={(event) => picked(event.target.value)}
          {...(field.maxLength !== undefined && { maxLength: field.maxLength })}
          {...(words.placeholder !== undefined && {
            placeholder: words.placeholder,
          })}
          {...(field.required !== false && { required: true })}
          {...(words.description !== undefined && {
            description: words.description,
          })}
          {...(error !== undefined && { errorMessage: error })}
        />
      );
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

function ProjectQuestion({
  organizationId,
  id,
  label,
  value,
  onChange,
  error,
  description,
}: {
  organizationId: string;
  id: string;
  label: string;
  value: string;
  onChange: (projectId: string) => void;
  error?: boolean;
  description?: string;
}) {
  const { t } = useT('automations');
  const { projects } = useProjects(organizationId);
  const options = useMemo(
    () =>
      projects.map((project) => ({ value: project._id, label: project.name })),
    [projects],
  );
  return (
    <SearchableSelect
      id={id}
      label={label}
      placeholder={t('templates.projectPlaceholder')}
      searchPlaceholder={t('templates.projectSearch')}
      emptyText={t('templates.projectEmpty')}
      options={options}
      value={value === '' ? null : value}
      onValueChange={onChange}
      required
      modal
      {...(error === true && { error })}
      {...(description !== undefined && { description })}
    />
  );
}

function MemberQuestion({
  organizationId,
  id,
  label,
  value,
  onChange,
  error,
  description,
}: {
  organizationId: string;
  id: string;
  label: string;
  value: string;
  onChange: (userId: string) => void;
  error?: boolean;
  description?: string;
}) {
  const { t } = useT('automations');
  const { members } = useMembers(organizationId);
  const options = useMemo(() => {
    const listed: SearchableSelectOption[] = [];
    for (const member of members ?? []) {
      // A disabled member is nobody to tell.
      if (member.role === 'disabled') continue;
      const option: SearchableSelectOption = {
        value: member.userId,
        label: member.displayName ?? member.email ?? member.userId,
      };
      if (member.email !== undefined) option.description = member.email;
      listed.push(option);
    }
    return listed;
  }, [members]);
  return (
    <SearchableSelect
      id={id}
      label={label}
      placeholder={t('templates.memberPlaceholder')}
      searchPlaceholder={t('templates.memberSearch')}
      emptyText={t('templates.memberEmpty')}
      options={options}
      value={value === '' ? null : value}
      onValueChange={onChange}
      required
      modal
      {...(error === true && { error })}
      {...(description !== undefined && { description })}
    />
  );
}
