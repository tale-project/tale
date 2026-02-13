'use client';

import type { Collection } from '@tanstack/db';

import { zodResolver } from '@hookform/resolvers/zod';
import { CronExpressionParser } from 'cron-parser';
import { Sparkles } from 'lucide-react';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import type { Id } from '@/convex/_generated/dataModel';
import type { WfSchedule } from '@/lib/collections/entities/wf-schedules';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useGenerateCron } from '../hooks/actions';
import { useCreateSchedule, useUpdateSchedule } from '../hooks/mutations';

interface ScheduleData {
  _id: Id<'wfSchedules'>;
  cronExpression: string;
  timezone: string;
}

interface ScheduleCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowRootId: Id<'wfDefinitions'>;
  organizationId: string;
  collection: Collection<WfSchedule, string>;
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
  workflowRootId,
  organizationId,
  collection,
  schedule,
}: ScheduleCreateDialogProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const createSchedule = useCreateSchedule(collection);
  const updateSchedule = useUpdateSchedule(collection);
  const { mutateAsync: generateCron, isPending: isGenerating } =
    useGenerateCron();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [naturalLanguage, setNaturalLanguage] = useState('');
  const [cronDescription, setCronDescription] = useState('');
  const [generateError, setGenerateError] = useState('');
  const isEdit = !!schedule;

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

  const { handleSubmit, register, reset, formState, setValue } = form;

  useEffect(() => {
    if (open) {
      reset({
        cronExpression: schedule?.cronExpression ?? '',
      });
      setNaturalLanguage('');
      setCronDescription('');
      setGenerateError('');
    }
  }, [open, schedule, reset]);

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
    setIsSubmitting(true);
    try {
      if (isEdit && schedule) {
        await updateSchedule({
          scheduleId: schedule._id,
          cronExpression: data.cronExpression,
          timezone: 'UTC',
        });
        toast({
          title: t('triggers.schedules.toast.updated'),
          variant: 'success',
        });
      } else {
        await createSchedule({
          organizationId,
          workflowRootId,
          cronExpression: data.cronExpression,
          timezone: 'UTC',
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
    } finally {
      setIsSubmitting(false);
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
      <Stack gap={4}>
        <Stack gap={2}>
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
              variant="outline"
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
        </Stack>

        <Stack gap={2}>
          <Input
            id="cronExpression"
            label={t('triggers.schedules.form.cronExpression')}
            placeholder={t('triggers.schedules.form.cronPlaceholder')}
            {...register('cronExpression')}
            className="font-mono"
            required
            errorMessage={formState.errors.cronExpression?.message}
          />
          <p className="text-muted-foreground text-xs">
            {t('triggers.schedules.form.cronHelp')}
          </p>
          <div className="flex flex-wrap gap-2">
            {CRON_PRESETS.map((preset) => (
              <Button
                key={preset.value}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setValue('cronExpression', preset.value)}
              >
                {t(`triggers.schedules.form.presets.${preset.label}`)}
              </Button>
            ))}
          </div>
        </Stack>
      </Stack>
    </FormDialog>
  );
}
