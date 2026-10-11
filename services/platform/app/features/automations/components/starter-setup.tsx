'use client';

import { Alert } from '@tale/ui/alert';
import { Checkbox } from '@tale/ui/checkbox';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { Select } from '@tale/ui/select';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { toast } from '@tale/ui/use-toast';
import { useId, useMemo, useRef, useState } from 'react';

import { useProjects } from '@/app/features/projects/hooks/queries';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { generatedAutomationSlug, slugFromName } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';
import { isEmittedEventType } from '@/lib/shared/event-types';
import { localTimeZone } from '@/lib/shared/zoned-time';

import { mergeNodeTypes } from '../hooks/backend';
import {
  useCreateAutomationFromTemplate,
  useDeployAutomation,
} from '../hooks/mutations';
import { useNodeTypeCatalog } from '../hooks/queries';
import {
  automationAnswerIssues,
  automationErrorCode,
  automationErrorMessage,
} from '../lib/errors';
import { eventWords } from '../lib/event-labels';
import {
  actionTitle,
  connectorName,
  coreTypeWord,
  nodeCatalogView,
  nodeIcon,
} from '../lib/node-face';
import {
  fieldWords,
  initialAnswers,
  optionLabel,
  type StarterCard,
  type StarterField,
  starterWords,
  unansweredFields,
} from '../lib/starters';
import {
  cronParseError,
  defaultTriggerDraft,
  type TriggerDraft,
  triggerDraftIssue,
} from '../lib/trigger-draft';
import { triggerIssueText } from '../lib/trigger-issue-text';
import { TriggerScheduleField } from './trigger-schedule-field';

/** What a create from a starter made: where to open it, and the webhook
 * token it minted, shown once. */
export interface StarterCreated {
  name: string;
  projectId?: string;
  token?: string;
}

/** The form of one starter: its answers, its name, and the create. */
export interface StarterSetup {
  formId: string;
  name: string;
  setName: (name: string) => void;
  nameError: string | undefined;
  slug: string;
  answers: Readonly<Record<string, string>>;
  setAnswer: (field: string, value: string) => void;
  schedule: TriggerDraft | null;
  patchSchedule: (patch: Partial<TriggerDraft>) => void;
  viewerZone: string;
  startNow: boolean;
  setStartNow: (on: boolean) => void;
  fieldErrors: Readonly<Record<string, string>>;
  submitting: boolean;
  canSubmit: boolean;
  disabledReason: string | undefined;
  submit: () => void;
}

/** What one starter's form holds while the reader answers it. */
interface StarterForm {
  /** The starter the form answers. */
  slug: string;
  name: string;
  nameError: string | undefined;
  /** The name a typed name with nothing to keep gets (`发票提醒`). */
  generatedSlug: string;
  answers: Record<string, string>;
  /** A schedule question's answer, as the schedule field's draft. */
  schedule: TriggerDraft | null;
  startNow: boolean;
  fieldErrors: Record<string, string>;
}

/** A starter's form as it opens: the starter's name in the reader's
 * language, the defaults its questions offer, its own schedule in the
 * reader's zone, and "Start it now" on. */
function startForm(
  card: StarterCard,
  options: { locale: string; viewerZone: string; projectId?: string },
): StarterForm {
  const draft = defaultTriggerDraft(options.viewerZone);
  const repeat = card.trigger?.kind === 'schedule' ? card.trigger.repeat : null;
  return {
    slug: card.slug,
    name: starterWords(card, options.locale).name,
    nameError: undefined,
    generatedSlug: generatedAutomationSlug(),
    answers: initialAnswers(card, {
      locale: options.locale,
      ...(options.projectId !== undefined && { projectId: options.projectId }),
    }),
    schedule: card.fields.some((field) => field.kind === 'schedule')
      ? repeat === null
        ? draft
        : { ...draft, repeat }
      : null,
    startNow: true,
    fieldErrors: {},
  };
}

/**
 * The form of the starter picked — kept by the gallery dialog, whose footer
 * holds the Create button — and the create itself: the answers go to the
 * server, which writes them into the starter's document and saves version
 * 1 with its trigger on when "Start it now" is; the version is then
 * deployed. A refusal comes back to the questions it names. Null while no
 * starter is picked; another starter starts from its own answers.
 */
export function useStarterSetup({
  organizationId,
  card,
  projectId,
  locale,
  onCreated,
}: {
  organizationId: string;
  card: StarterCard | null;
  /** The project the gallery was opened in: its project question starts
   * there. */
  projectId?: string;
  locale: string;
  onCreated: (created: StarterCreated) => void;
}): StarterSetup | null {
  const { t } = useT('automations');
  const { t: tRecurrence } = useT('recurrence');
  const formId = useId();
  const create = useCreateAutomationFromTemplate();
  const { mutateAsync: deployAutomation } = useDeployAutomation();
  const [viewerZone] = useState(localTimeZone);
  const [form, setForm] = useState<StarterForm | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A synchronous latch: a fast double Enter could fire the create twice
  // before `submitting` disables the button.
  const creatingRef = useRef(false);

  // The form follows the starter picked, reset in the render that picks it.
  if (card === null ? form !== null : form?.slug !== card.slug) {
    setForm(
      card === null
        ? null
        : startForm(card, {
            locale,
            viewerZone,
            ...(projectId !== undefined && { projectId }),
          }),
    );
  }
  if (card === null || form === null || form.slug !== card.slug) return null;

  const update = (patch: (current: StarterForm) => Partial<StarterForm>) =>
    setForm((current) =>
      current === null ? current : { ...current, ...patch(current) },
    );
  const { name, answers, schedule } = form;
  const typedSlug = slugFromName(name);
  const slug =
    name.trim() === '' ? '' : typedSlug === '' ? form.generatedSlug : typedSlug;
  const unanswered = unansweredFields(card, answers);
  const scheduleIssue = schedule === null ? null : triggerDraftIssue(schedule);
  const canSubmit =
    slug !== '' && unanswered.length === 0 && scheduleIssue === null;
  const disabledReason =
    slug === ''
      ? t('starters.nameRequired')
      : unanswered.length > 0
        ? t('starters.answerEveryQuestion')
        : scheduleIssue !== null && schedule !== null
          ? triggerIssueText(
              scheduleIssue,
              { t, tRecurrence, locale },
              { cronReason: cronParseError(schedule.cron) },
            )
          : undefined;
  const scheduleField = card.fields.find((field) => field.kind === 'schedule');

  const fieldError = (field: StarterField, code: string): string => {
    if (code === 'required') return t('starters.errors.required');
    if (code === 'too_long') return t('starters.errors.tooLong');
    if (code === 'unknown') {
      if (field.kind === 'project') return t('starters.errors.unknownProject');
      if (field.kind === 'member') return t('starters.errors.unknownMember');
      if (field.kind === 'credential') {
        return t('starters.errors.unknownCredential');
      }
    }
    if (field.kind === 'schedule') return t('starters.errors.schedule');
    if (field.kind === 'choice') return t('starters.errors.choice');
    return t('starters.errors.invalid');
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
        slug: card.slug,
        name: slug,
        // The display name as typed; the slug only addresses it.
        displayName: name.trim(),
        answers: { ...answers, ...scheduleAnswer },
        locale,
        enableTrigger: form.startNow,
      });
      if (form.startNow) {
        try {
          await deployAutomation({
            organizationId,
            name: created.name,
            version: created.version,
          });
        } catch (error) {
          // The automation exists as a draft; the editor deploys it.
          toast({
            title: t('blank.deployFailed', {
              error: automationErrorMessage(error),
            }),
            variant: 'destructive',
          });
        }
      }
      const project = card.fields.find((field) => field.kind === 'project');
      const installedIn =
        project === undefined ? '' : (answers[project.id] ?? '');
      creatingRef.current = false;
      setSubmitting(false);
      onCreated({
        name: created.name,
        ...(installedIn !== '' && { projectId: installedIn }),
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
          const field = card.fields.find((entry) => entry.id === issue.field);
          if (field !== undefined) {
            errors[field.id] = fieldError(field, issue.code);
          }
        }
        if (Object.keys(errors).length > 0) {
          update(() => ({ fieldErrors: errors }));
        } else {
          toast({
            title: automationErrorMessage(error),
            variant: 'destructive',
          });
        }
      }
      creatingRef.current = false;
      setSubmitting(false);
    }
  };

  const withoutError = (
    current: StarterForm,
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
    startNow: form.startNow,
    setStartNow: (on) => update(() => ({ startNow: on })),
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

/** The starter's questions, its name, how it works and "Start it now". */
export function StarterSetupFields({
  organizationId,
  card,
  setup,
  locale,
}: {
  organizationId: string;
  card: StarterCard;
  setup: StarterSetup;
  locale: string;
}) {
  const { t } = useT('automations');
  const words = starterWords(card, locale);
  const catalogQuery = useNodeTypeCatalog(organizationId);
  const catalog = useMemo(
    () =>
      nodeCatalogView(
        mergeNodeTypes(catalogQuery.data?.nodeTypes),
        catalogQuery.data?.connectors ?? [],
      ),
    [catalogQuery.data],
  );
  const missing = card.connectors.filter((connector) => !connector.connected);

  const stepLabel = (type: string): string => {
    const dot = type.indexOf('.');
    if (dot <= 0) return coreTypeWord(type, t);
    return t('starters.stepLabel', {
      connector: connectorName(type.slice(0, dot), catalog, locale),
      action: actionTitle(type, catalog, locale),
    });
  };

  const startsWhen =
    card.trigger?.kind === 'event' &&
    card.trigger.event !== null &&
    isEmittedEventType(card.trigger.event)
      ? t('starters.startsOnEvent', {
          event: eventWords(card.trigger.event, t).label,
        })
      : card.trigger?.kind === 'webhook'
        ? t('starters.startsOnWebhook')
        : card.trigger?.kind === 'schedule'
          ? t('starters.startsOnSchedule')
          : t('starters.startsByHand');

  return (
    <form
      id={setup.formId}
      onSubmit={(event) => {
        event.preventDefault();
        setup.submit();
      }}
    >
      <Stack gap={4}>
        <Text as="p" className="text-sm">
          {words.details}
        </Text>
        <section aria-labelledby={`${setup.formId}-how`}>
          <Text
            as="h3"
            id={`${setup.formId}-how`}
            className="mb-2 text-sm font-medium"
          >
            {t('starters.howItWorks')}
          </Text>
          <Text as="p" variant="muted" className="mb-2 text-xs">
            {startsWhen}
          </Text>
          <ol className="flex flex-col gap-1.5">
            {card.steps.map((step) => {
              const Icon = nodeIcon(step, catalog);
              return (
                <li
                  key={step.id}
                  className="text-muted-foreground flex items-center gap-2 text-xs"
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  <span>{stepLabel(step.type)}</span>
                </li>
              );
            })}
          </ol>
        </section>
        {missing.length > 0 && (
          <Alert
            variant="warning"
            description={t('starters.needsConnection', {
              connectors: new Intl.ListFormat(locale, {
                type: 'conjunction',
              }).format(
                missing.map((connector) =>
                  connectorName(connector.slug, catalog, locale),
                ),
              ),
            })}
          />
        )}
        <Input
          id={`${setup.formId}-name`}
          label={t('blank.nameLabel')}
          value={setup.name}
          onChange={(event) => setup.setName(event.target.value)}
          errorMessage={setup.nameError}
          required
          {...(setup.slug !== '' && setup.slug !== setup.name.trim()
            ? { description: t('blank.slugHint', { slug: setup.slug }) }
            : {})}
        />
        {card.fields.map((field) => (
          <StarterQuestion
            key={field.id}
            organizationId={organizationId}
            field={field}
            setup={setup}
            locale={locale}
          />
        ))}
        <Checkbox
          id={`${setup.formId}-start`}
          label={t('starters.startNow')}
          description={t('starters.startNowHint')}
          checked={setup.startNow}
          onCheckedChange={(checked) => setup.setStartNow(checked === true)}
        />
      </Stack>
    </form>
  );
}

function StarterQuestion({
  organizationId,
  field,
  setup,
  locale,
}: {
  organizationId: string;
  field: StarterField;
  setup: StarterSetup;
  locale: string;
}) {
  const { t } = useT('automations');
  const words = fieldWords(field, locale);
  const id = `${setup.formId}-${field.id}`;
  const error = setup.fieldErrors[field.id];
  const value = setup.answers[field.id] ?? '';
  const picked = (next: string) => setup.setAnswer(field.id, next);
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
          value={value}
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
          value={value}
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
          value={value}
          onValueChange={picked}
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
    case 'credential':
      return (
        <Input
          id={id}
          label={words.label}
          value={value}
          onChange={(event) => picked(event.target.value)}
          required
          {...(words.description !== undefined && {
            description: words.description,
          })}
          {...(error !== undefined && { errorMessage: error })}
          placeholder={t('starters.credentialPlaceholder')}
        />
      );
    case 'text':
      return field.multiline === true ? (
        <Textarea
          id={id}
          label={words.label}
          value={value}
          onChange={(event) => picked(event.target.value)}
          rows={3}
          {...(field.maxLength !== undefined && { maxLength: field.maxLength })}
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
          value={value}
          onChange={(event) => picked(event.target.value)}
          {...(field.maxLength !== undefined && { maxLength: field.maxLength })}
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
      placeholder={t('starters.projectPlaceholder')}
      searchPlaceholder={t('starters.projectSearch')}
      emptyText={t('starters.projectEmpty')}
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
      placeholder={t('starters.memberPlaceholder')}
      searchPlaceholder={t('starters.memberSearch')}
      emptyText={t('starters.memberEmpty')}
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
