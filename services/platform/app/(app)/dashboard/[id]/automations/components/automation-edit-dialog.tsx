'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/components/ui/dialog/form-dialog';
import { Input } from '@/components/ui/forms/input';
import { Textarea } from '@/components/ui/forms/textarea';
import { JsonInput } from '@/components/ui/forms/json-input';
import { Stack, Grid } from '@/components/ui/layout/layout';
import { toast } from '@/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

interface AutomationConfig {
  timeout?: number;
  retryPolicy?: { maxRetries?: number; backoffMs?: number };
  variables?: Record<string, unknown>;
}

type FormData = {
  name: string;
  description: string;
  timeout: number;
  maxRetries: number;
  backoffMs: number;
  variables: string;
};

interface EditAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: Doc<'wfDefinitions'> | null;
  onUpdateAutomation: (
    automationId: string,
    data: {
      name: string;
      description?: string;
      config?: {
        timeout?: number;
        retryPolicy?: {
          maxRetries: number;
          backoffMs: number;
        };
        variables?: Record<string, unknown>;
      };
    },
  ) => Promise<void>;
}

export function EditAutomationDialog({
  open,
  onOpenChange,
  workflow,
  onUpdateAutomation,
}: EditAutomationDialogProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');

  const formSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, tCommon('validation.required', { field: t('configuration.name') })),
        description: z.string(),
        timeout: z.number().min(1000).max(3600000),
        maxRetries: z.number().min(0).max(10),
        backoffMs: z.number().min(100).max(60000),
        variables: z.string(),
      }),
    [t, tCommon],
  );

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      timeout: 300000,
      maxRetries: 3,
      backoffMs: 1000,
      variables: '{\n  "environment": "test"\n}',
    },
  });

  const variables = watch('variables');

  useEffect(() => {
    if (workflow) {
      const config = workflow.config as AutomationConfig;
      reset({
        name: workflow.name,
        description: workflow.description || '',
        timeout: config?.timeout || 300000,
        maxRetries: config?.retryPolicy?.maxRetries || 3,
        backoffMs: config?.retryPolicy?.backoffMs || 1000,
        variables: JSON.stringify(
          config?.variables || { environment: 'test' },
          null,
          2,
        ),
      });
    }
  }, [workflow, reset]);

  const onSubmit = async (data: FormData) => {
    if (!workflow) return;

    let parsedVariables: Record<string, unknown> = {};
    if (data.variables.trim()) {
      try {
        parsedVariables = JSON.parse(data.variables);
      } catch {
        toast({
          title: t('configuration.validation.invalidJson'),
          variant: 'destructive',
        });
        return;
      }
    }

    try {
      await onUpdateAutomation(workflow._id, {
        name: data.name.trim(),
        description: data.description.trim() || undefined,
        config: {
          timeout: data.timeout,
          retryPolicy: {
            maxRetries: data.maxRetries,
            backoffMs: data.backoffMs,
          },
          variables: parsedVariables,
        },
      });

      onOpenChange(false);
    } catch (error) {
      console.error('Failed to update automation:', error);
    }
  };

  if (!workflow) return null;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('editDialog.title')}
      submitText={t('editDialog.updateButton')}
      submittingText={t('editDialog.updating')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
      large
      className="max-h-[80vh]"
    >
      <Input
        id="edit-name"
        label={t('configuration.name')}
        required
        {...register('name')}
        placeholder={t('editDialog.namePlaceholder')}
        disabled={isSubmitting}
        errorMessage={errors.name?.message}
      />

      <Textarea
        id="edit-description"
        label={t('configuration.description')}
        {...register('description')}
        placeholder={t('editDialog.descriptionPlaceholder')}
        rows={3}
        disabled={isSubmitting}
      />

      <Stack gap={4}>
        <Grid cols={3} gap={2}>
          <Input
            id="edit-timeout"
            type="number"
            label={t('configuration.timeout')}
            {...register('timeout', { valueAsNumber: true })}
            placeholder={t('editDialog.timeoutPlaceholder')}
            disabled={isSubmitting}
            errorMessage={errors.timeout?.message}
          />
          <Input
            id="edit-maxRetries"
            type="number"
            label={t('configuration.maxRetries')}
            {...register('maxRetries', { valueAsNumber: true })}
            placeholder={t('editDialog.maxRetriesPlaceholder')}
            disabled={isSubmitting}
            errorMessage={errors.maxRetries?.message}
          />
          <Input
            id="edit-backoffMs"
            type="number"
            label={t('configuration.backoff')}
            {...register('backoffMs', { valueAsNumber: true })}
            placeholder={t('editDialog.backoffPlaceholder')}
            disabled={isSubmitting}
            errorMessage={errors.backoffMs?.message}
          />
        </Grid>

        <JsonInput
          id="edit-variables"
          label={t('configuration.variables')}
          value={variables}
          onChange={(value) => setValue('variables', value)}
          placeholder={t('editDialog.variablesPlaceholder')}
          rows={4}
          disabled={isSubmitting}
          description={t('editDialog.variablesDescription')}
        />
      </Stack>
    </FormDialog>
  );
}
