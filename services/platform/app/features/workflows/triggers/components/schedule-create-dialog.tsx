'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@tale/ui/button';
import { Field } from '@tale/ui/field';
import { Row, Stack } from '@tale/ui/layout';
import { Popover } from '@tale/ui/popover';
import { Text } from '@tale/ui/text';
import { CronExpressionParser } from 'cron-parser';
import { Sparkles } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { JsonInput } from '@/app/components/ui/forms/json-input';
import { Select } from '@/app/components/ui/forms/select';
import { useForm } from '@/app/components/ui/forms/use-form';
import {
  ConfigFieldInput,
  initFieldValues,
} from '@/app/features/automations/components/config-field-inputs';
import { useConfigFieldText } from '@/app/features/automations/hooks/use-automation-text';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { useToast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import type { AutomationConfigField } from '@/lib/shared/schemas/automation_views';

import { buildInputTemplateFromSchema } from '../../utils/input-schema-template';
import { useGenerateCron } from '../hooks/actions';
import { useCreateSchedule, useUpdateSchedule } from '../hooks/slug-mutations';
import { useWorkflowInputSchema } from '../hooks/use-workflow-input-schema';
import { mapTriggerError } from '../lib/map-trigger-error';
import {
  assembleScheduleVariables,
  buildScheduleConfigFields,
  seedScheduleFieldValues,
} from '../utils/schedule-config-fields';
import { computeScheduleVariablesValidity } from '../utils/schedule-variables-validity';
import {
  browserTimezone,
  listTimezoneOptions,
} from '../utils/timezone-options';

interface ScheduleData {
  _id: string;
  cronExpression: string;
  timezone: string;
  /** The project this schedule is bound to (`wfSchedules.projectId`) — the
   *  structured form's `projectId` field defaults to it (#2614). */
  projectId?: string;
  variables?: Record<string, unknown> | null;
}

interface ScheduleCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowRootId: string;
  organizationId: string;
  workflowSlug: string;
  schedule?: ScheduleData | null;
}

type ScheduleFormData = {
  cronExpression: string;
};

const CRON_PRESETS = [
  { label: 'every5Minutes', value: '*/5 * * * *' },
  { label: 'hourly', value: '0 * * * *' },
  { label: 'daily', value: '0 0 * * *' },
  { label: 'weekly', value: '0 0 * * 1' },
  { label: 'monthly', value: '0 0 1 * *' },
];

export function ScheduleCreateDialog({
  open,
  onOpenChange,
  workflowRootId: _workflowRootId,
  organizationId,
  workflowSlug,
  schedule,
}: ScheduleCreateDialogProps) {
  const { t } = useT('workflows');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const { mutateAsync: createSchedule, isPending: isCreatingSchedule } =
    useCreateSchedule();
  const { mutateAsync: updateSchedule, isPending: isUpdatingSchedule } =
    useUpdateSchedule();
  const { mutateAsync: generateCron, isPending: isGenerating } =
    useGenerateCron();
  const isSubmitting = isCreatingSchedule || isUpdatingSchedule;
  const [naturalLanguage, setNaturalLanguage] = useState('');
  const [cronDescription, setCronDescription] = useState('');
  const [generateError, setGenerateError] = useState('');
  const [isGeneratePopoverOpen, setIsGeneratePopoverOpen] = useState(false);
  const isEdit = !!schedule;
  const baseId = useId();

  // Pull the workflow's start-node inputSchema so we can pre-fill the variables
  // editor with the expected shape — same pattern as the test panel.
  const inputSchema = useWorkflowInputSchema(organizationId, workflowSlug);
  const inputTemplate = useMemo(
    () => buildInputTemplateFromSchema(inputSchema),
    [inputSchema],
  );
  const hasInputSchema = inputTemplate !== '{}';

  const { projects } = useProjects(organizationId);
  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p._id, label: p.name })),
    [projects],
  );

  const text = useConfigFieldText();
  const fields = useMemo(
    () =>
      buildScheduleConfigFields(inputSchema, projectOptions, {
        projectLabel: t('triggers.schedules.form.projectLabel'),
        projectPlaceholder: t('triggers.schedules.form.projectPlaceholder'),
        repoLabel: t('triggers.schedules.form.repoLabel'),
        repoPlaceholder: t('triggers.schedules.form.repoPlaceholder'),
      }),
    [inputSchema, projectOptions, t],
  );
  // A schema with an array/object property (other than the recognized
  // owner/repo pair) can't render as plain controls — fall back to JSON only.
  const canUseForm = fields !== null && fields.length > 0;
  // `fields` itself is a fresh array every render whenever any of its own
  // inputs (notably `projectOptions`, which is `[]` on every render while
  // `useProjects` is still loading) is referentially unstable — depending on
  // `fields` directly in the reset effect below would then re-fire, and
  // re-seed `values`, on EVERY render, an infinite loop (`useProjects`'s
  // `data ?? []` fallback has no stable identity of its own). The field KEYS
  // are what actually matter for re-seeding (e.g. the schema finishing its
  // own load) — collapse to that stable primitive for the dependency array.
  const fieldsKey = fields ? fields.map((f) => f.key).join('|') : '';

  const initialVariablesJson = useMemo(() => {
    if (schedule?.variables && Object.keys(schedule.variables).length > 0) {
      return JSON.stringify(schedule.variables, null, 2);
    }
    return inputTemplate;
  }, [schedule, inputTemplate]);

  const [variablesJson, setVariablesJson] = useState(initialVariablesJson);
  const [mode, setMode] = useState<'form' | 'json'>(
    canUseForm ? 'form' : 'json',
  );
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [timezone, setTimezone] = useState(
    () => schedule?.timezone ?? browserTimezone(),
  );
  const timezoneOptions = useMemo(() => listTimezoneOptions(), []);

  const schema = useMemo(
    () =>
      z.object({
        cronExpression: z
          .string()
          .trim()
          .min(1, t('triggers.schedules.form.validation.cronRequired'))
          .refine((value) => {
            try {
              CronExpressionParser.parse(value);
              return true;
            } catch {
              return false;
            }
          }, t('triggers.schedules.form.validation.cronInvalid')),
      }),
    [t],
  );

  const form = useForm<ScheduleFormData>({
    resolver: zodResolver(schema),
    // Validate on change so Create stays disabled until the cron
    // expression is present and valid.
    defaultValues: {
      cronExpression: schedule?.cronExpression ?? '',
    },
  });

  const {
    handleSubmit,
    register,
    reset,
    formState: { errors: formErrors, isValid },
    setValue,
  } = form;

  useEffect(() => {
    if (!open) return;
    reset({ cronExpression: schedule?.cronExpression ?? '' });
    setNaturalLanguage('');
    setCronDescription('');
    setGenerateError('');
    setIsGeneratePopoverOpen(false);
    setTimezone(schedule?.timezone ?? browserTimezone());
    setVariablesJson(initialVariablesJson);
    if (fields !== null && fields.length > 0) {
      setValues(
        initFieldValuesFor(fields, schedule?.variables, schedule?.projectId),
      );
      setMode('form');
    } else {
      setMode('json');
    }
    // `fieldsKey` (not `fields` itself) is the dependency — see the comment
    // above `fieldsKey` — so this only re-seeds when the schema's field set
    // actually gains/loses a key (e.g. the workflow read resolving after the
    // dialog is already open), not on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `fields` (read inside) is intentionally NOT a dep; `fieldsKey` is its stable proxy, see comment above its declaration
  }, [open, schedule, reset, initialVariablesJson, fieldsKey]);

  const { variables: assembledVariables, invalidFields: deriveInvalidFields } =
    useMemo(
      () =>
        fields
          ? assembleScheduleVariables(fields, values)
          : { variables: {}, invalidFields: [] },
      [fields, values],
    );

  const parsedJson = useMemo<Record<string, unknown> | null>(() => {
    const trimmed = variablesJson.trim();
    if (trimmed === '' || trimmed === '{}') return {};
    try {
      const parsed: unknown = JSON.parse(variablesJson);
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        return null;
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime guard above narrows to non-null, non-array object
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [variablesJson]);

  const effectiveVariables =
    mode === 'json' ? (parsedJson ?? {}) : assembledVariables;

  const {
    missingRequiredFields,
    missingRequiredSet,
    jsonIsValid,
    variablesValid,
  } = computeScheduleVariablesValidity({
    hasInputSchema,
    inputSchema,
    mode,
    parsedJson,
    effectiveVariables,
    deriveInvalidCount: deriveInvalidFields.length,
  });

  const jsonErrorMessage =
    mode === 'json' && hasInputSchema
      ? !jsonIsValid
        ? t('triggers.schedules.form.variablesInvalid')
        : missingRequiredFields.length > 0
          ? t('triggers.schedules.form.validation.missingRequired', {
              fields: missingRequiredFields.join(', '),
            })
          : undefined
      : undefined;

  const handleToggleMode = useCallback(() => {
    if (mode === 'form') {
      // Show exactly what would be saved.
      setVariablesJson(JSON.stringify(assembledVariables, null, 2));
      setMode('json');
      return;
    }
    if (fields && parsedJson) {
      setValues(initFieldValuesFor(fields, parsedJson, schedule?.projectId));
    }
    setMode('form');
  }, [mode, assembledVariables, fields, parsedJson, schedule?.projectId]);

  const handleGenerate = useCallback(async () => {
    if (!naturalLanguage.trim() || isGenerating) return;

    setGenerateError('');
    setCronDescription('');

    try {
      const result = await generateCron({
        naturalLanguage: naturalLanguage.trim(),
        organizationId,
      });
      setValue('cronExpression', result.cronExpression, {
        shouldValidate: true,
      });
      setCronDescription(result.description);
      setIsGeneratePopoverOpen(false);
    } catch {
      setGenerateError(t('triggers.schedules.form.ai.generateError'));
    }
  }, [
    naturalLanguage,
    isGenerating,
    generateCron,
    organizationId,
    setValue,
    t,
  ]);

  const onSubmit = async (data: ScheduleFormData) => {
    // Defense in depth — Save is already disabled while invalid.
    if (!variablesValid) return;
    const variablesToSave = hasInputSchema ? effectiveVariables : undefined;

    try {
      if (isEdit && schedule) {
        await updateSchedule({
          scheduleId: toId<'wfSchedules'>(schedule._id),
          cronExpression: data.cronExpression,
          timezone,
          variables: variablesToSave,
        });
        toast({
          title: t('triggers.schedules.toast.updated'),
          variant: 'success',
        });
      } else {
        await createSchedule({
          organizationId,
          workflowSlug,
          cronExpression: data.cronExpression,
          timezone,
          variables: variablesToSave,
        });
        toast({
          title: t('triggers.schedules.toast.created'),
          variant: 'success',
        });
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        title: mapTriggerError(err, t, tCommon('errors.generic')),
        variant: 'destructive',
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        isEdit
          ? t('triggers.schedules.form.editTitle')
          : t('triggers.schedules.form.title')
      }
      submitText={isEdit ? tCommon('actions.save') : tCommon('actions.create')}
      submittingText={tCommon('actions.loading')}
      isSubmitting={isSubmitting}
      isValid={isValid && variablesValid}
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormSection>
        <FormSection>
          <Input
            id="cronExpression"
            label={t('triggers.schedules.form.cronExpression')}
            placeholder={t('triggers.schedules.form.cronPlaceholder')}
            {...register('cronExpression')}
            className="font-mono"
            required
            errorMessage={formErrors.cronExpression?.message}
          />
          <Text variant="caption">{t('triggers.schedules.form.cronHelp')}</Text>
          <Row gap={2} align="stretch" wrap>
            {CRON_PRESETS.map((preset) => (
              <Button
                key={preset.value}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setValue('cronExpression', preset.value, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
              >
                {t(`triggers.schedules.form.presets.${preset.label}`)}
              </Button>
            ))}
            <Popover
              open={isGeneratePopoverOpen}
              onOpenChange={(next) => {
                setIsGeneratePopoverOpen(next);
                if (!next) setGenerateError('');
              }}
              align="start"
              contentClassName="w-80 max-w-[20rem]"
              trigger={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={Sparkles}
                  aria-label={t('triggers.schedules.form.ai.generateButton')}
                >
                  {t('triggers.schedules.form.ai.generateButton')}
                </Button>
              }
            >
              <Stack gap={3}>
                <Input
                  id="naturalLanguage"
                  label={t('triggers.schedules.form.ai.label')}
                  placeholder={t('triggers.schedules.form.ai.placeholder')}
                  value={naturalLanguage}
                  onChange={(e) => setNaturalLanguage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleGenerate();
                    }
                  }}
                  disabled={isGenerating}
                  errorMessage={generateError}
                />
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleGenerate}
                  disabled={!naturalLanguage.trim() || isGenerating}
                  isLoading={isGenerating}
                  icon={Sparkles}
                  className="self-end"
                >
                  {t('triggers.schedules.form.ai.generateButton')}
                </Button>
              </Stack>
            </Popover>
          </Row>
          {cronDescription && (
            <output
              className="text-muted-foreground text-xs"
              aria-live="polite"
            >
              {cronDescription}
            </output>
          )}
        </FormSection>

        <FormSection>
          <Select
            id="schedule-timezone"
            label={t('triggers.schedules.form.timezoneLabel')}
            options={timezoneOptions}
            value={timezone}
            onValueChange={setTimezone}
          />
        </FormSection>

        {hasInputSchema && (
          <FormSection>
            {canUseForm && (
              <Row justify="end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleToggleMode}
                >
                  {mode === 'json'
                    ? t('triggers.schedules.form.useFormToggle')
                    : t('triggers.schedules.form.editAsJsonToggle')}
                </Button>
              </Row>
            )}

            {mode === 'form' && fields ? (
              <Stack gap={3}>
                <Text variant="label">
                  {t('triggers.schedules.form.variablesLabel')}
                </Text>
                <Text variant="caption">
                  {t('triggers.schedules.form.variablesDescription')}
                </Text>
                {fields.map((f) => {
                  const fieldId = `${baseId}-${f.key}`;
                  const derivedKeys = f.derive ? f.derive.into : [f.key];
                  const isMissing = derivedKeys.some((k) =>
                    missingRequiredSet.has(k),
                  );
                  const isInvalidDerive = deriveInvalidFields.includes(f.key);
                  const label = text.label(f);
                  const error = isInvalidDerive
                    ? t('triggers.schedules.form.repoInvalid')
                    : isMissing
                      ? tCommon('validation.required', { field: label })
                      : undefined;
                  return (
                    <Field
                      key={f.key}
                      label={label}
                      htmlFor={fieldId}
                      required={f.required}
                      error={error}
                      description={text.help(f)}
                    >
                      <ConfigFieldInput
                        id={fieldId}
                        field={f}
                        value={values[f.key]}
                        text={text}
                        disabled={isSubmitting}
                        onChange={(next) =>
                          setValues((s) => ({ ...s, [f.key]: next }))
                        }
                      />
                    </Field>
                  );
                })}
              </Stack>
            ) : (
              <JsonInput
                value={variablesJson}
                onChange={setVariablesJson}
                label={t('triggers.schedules.form.variablesLabel')}
                description={t('triggers.schedules.form.variablesDescription')}
                rows={6}
                errorMessage={jsonErrorMessage}
              />
            )}
          </FormSection>
        )}
      </FormSection>
    </FormDialog>
  );
}

/** `initFieldValues` (config-field-inputs.tsx) seeded via
 *  `seedScheduleFieldValues` — factored so both the open-effect and the
 *  form↔JSON toggle share the exact same seeding. */
function initFieldValuesFor(
  fields: AutomationConfigField[] | null,
  variables: Record<string, unknown> | null | undefined,
  boundProjectId: string | undefined,
): Record<string, string | boolean> {
  return initFieldValues(
    fields ?? [],
    seedScheduleFieldValues(
      fields ?? [],
      variables ?? undefined,
      boundProjectId,
    ),
  );
}
