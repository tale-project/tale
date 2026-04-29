'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CronExpressionParser } from 'cron-parser';
import { Sparkles } from 'lucide-react';
import { useMemo, useEffect, useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { JsonInput } from '@/app/components/ui/forms/json-input';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useToast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import { useReadWorkflow } from '../../hooks/file-queries';
import { buildInputTemplateFromSchema } from '../../utils/input-schema-template';
import { useGenerateCron } from '../hooks/actions';
import { useCreateSchedule, useUpdateSchedule } from '../hooks/slug-mutations';

interface ScheduleData {
  _id: string;
  cronExpression: string;
  timezone: string;
  variables?: Record<string, unknown> | null;
}

interface ScheduleCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowRootId: string;
  organizationId: string;
  orgSlug: string;
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
  orgSlug,
  workflowSlug,
  schedule,
}: ScheduleCreateDialogProps) {
  const { t } = useT('automations');
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
  const isEdit = !!schedule;

  // Pull the workflow's start-node inputSchema so we can pre-fill the variables
  // editor with the expected shape — same pattern as the test panel.
  const { data: workflowRead } = useReadWorkflow(orgSlug, workflowSlug);
  const inputTemplate = useMemo(() => {
    if (!workflowRead?.ok) return '{}';
    const startStep = workflowRead.config.steps?.find(
      (s) => s.stepType === 'start',
    );
    const startConfig = startStep?.config as
      | { inputSchema?: Parameters<typeof buildInputTemplateFromSchema>[0] }
      | undefined;
    return buildInputTemplateFromSchema(startConfig?.inputSchema);
  }, [workflowRead]);

  const hasInputSchema = inputTemplate !== '{}';

  const initialVariablesJson = useMemo(() => {
    if (schedule?.variables && Object.keys(schedule.variables).length > 0) {
      return JSON.stringify(schedule.variables, null, 2);
    }
    return inputTemplate;
  }, [schedule, inputTemplate]);

  const [variablesJson, setVariablesJson] = useState(initialVariablesJson);
  const [variablesError, setVariablesError] = useState('');

  const schema = useMemo(
    () =>
      z.object({
        cronExpression: z
          .string()
          .trim()
          .min(1, 'Cron expression is required')
          .refine((value) => {
            try {
              CronExpressionParser.parse(value);
              return true;
            } catch {
              return false;
            }
          }, 'Must be a valid 5-field cron expression'),
      }),
    [],
  );

  const form = useForm<ScheduleFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      cronExpression: schedule?.cronExpression ?? '',
    },
  });

  const {
    handleSubmit,
    register,
    reset,
    formState: { errors: formErrors },
    setValue,
  } = form;

  useEffect(() => {
    if (open) {
      reset({
        cronExpression: schedule?.cronExpression ?? '',
      });
      setNaturalLanguage('');
      setCronDescription('');
      setGenerateError('');
      setVariablesJson(initialVariablesJson);
      setVariablesError('');
    }
  }, [open, schedule, reset, initialVariablesJson]);

  const handleGenerate = useCallback(async () => {
    if (!naturalLanguage.trim() || isGenerating) return;

    setGenerateError('');
    setCronDescription('');

    try {
      const result = await generateCron({
        naturalLanguage: naturalLanguage.trim(),
      });
      setValue('cronExpression', result.cronExpression, {
        shouldValidate: true,
      });
      setCronDescription(result.description);
    } catch {
      setGenerateError(t('triggers.schedules.form.ai.generateError'));
    }
  }, [naturalLanguage, isGenerating, generateCron, setValue, t]);

  const onSubmit = async (data: ScheduleFormData) => {
    let parsedVariables: Record<string, unknown> | undefined;
    if (variablesJson.trim() && variablesJson.trim() !== '{}') {
      try {
        const parsed: unknown = JSON.parse(variablesJson);
        if (
          parsed === null ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed)
        ) {
          throw new Error('not an object');
        }
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime guard above narrows to non-null, non-array object
        parsedVariables = parsed as Record<string, unknown>;
      } catch {
        setVariablesError(t('triggers.schedules.form.variablesInvalid'));
        return;
      }
    }
    setVariablesError('');

    try {
      if (isEdit && schedule) {
        await updateSchedule({
          scheduleId: toId<'wfSchedules'>(schedule._id),
          cronExpression: data.cronExpression,
          timezone: 'UTC',
          variables: parsedVariables,
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
          timezone: 'UTC',
          variables: parsedVariables,
        });
        toast({
          title: t('triggers.schedules.toast.created'),
          variant: 'success',
        });
      }
      onOpenChange(false);
    } catch {
      toast({
        title: tCommon('errors.generic'),
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
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormSection>
        <FormSection>
          <div className="flex gap-2">
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
              wrapperClassName="flex-1"
              errorMessage={generateError}
            />
            <Button
              type="button"
              variant="secondary"
              size="default"
              onClick={handleGenerate}
              disabled={!naturalLanguage.trim() || isGenerating}
              isLoading={isGenerating}
              icon={Sparkles}
              className="mt-7 shrink-0"
              aria-label={t('triggers.schedules.form.ai.generateButton')}
            >
              {t('triggers.schedules.form.ai.generateButton')}
            </Button>
          </div>
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
          <div className="flex flex-wrap gap-2">
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
          </div>
        </FormSection>

        {hasInputSchema && (
          <FormSection>
            <JsonInput
              value={variablesJson}
              onChange={(value) => {
                setVariablesJson(value);
                setVariablesError('');
              }}
              label={t('triggers.schedules.form.variablesLabel')}
              description={t('triggers.schedules.form.variablesDescription')}
              rows={6}
              errorMessage={variablesError}
            />
          </FormSection>
        )}
      </FormSection>
    </FormDialog>
  );
}
