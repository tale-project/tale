'use client';

import { useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Stack } from '@/app/components/ui/layout/layout';
import { Select } from '@/app/components/ui/forms/select';
import { JsonInput } from '@/app/components/ui/forms/json-input';
import { toast } from '@/app/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

interface CreateStepDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateStep: (data: {
    name: string;
    stepType: Doc<'wfStepDefs'>['stepType'];
    config: Doc<'wfStepDefs'>['config'];
    nextSteps?: Doc<'wfStepDefs'>['nextSteps'];
  }) => Promise<void>;
}

type FormData = {
  name: string;
  stepType: Doc<'wfStepDefs'>['stepType'];
  config: string;
  nextSteps: string;
};

const getDefaultTemplates = (
  stepType: Doc<'wfStepDefs'>['stepType'],
): { config: string } => {
  switch (stepType) {
    case 'trigger': {
      const cfg = { type: 'manual', context: {} };
      return {
        config: JSON.stringify(cfg, null, 2),
      };
    }
    case 'llm': {
      const cfg = {
        name: 'LLM Analysis',
        model: 'gpt-4o',
        temperature: 0.2,
        maxTokens: 1000,
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'Analyze the following data: {{input_data}}',
        outputFormat: 'text',
        tools: [],
        contextVariables: {},
      };
      return {
        config: JSON.stringify(cfg, null, 2),
      };
    }
    case 'condition': {
      const cfg = {
        expression: '{{score}} > 0.7',
        description: 'Check if score is above threshold',
        variables: {},
      };
      return {
        config: JSON.stringify(cfg, null, 2),
      };
    }

    case 'action':
    default: {
      const cfg = {
        type: 'log',
        parameters: { message: 'Hello from action step' },
      };
      return {
        config: JSON.stringify(cfg, null, 2),
      };
    }
  }
};

export function CreateStepDialog({
  open,
  onOpenChange,
  onCreateStep,
}: CreateStepDialogProps) {
  const { t } = useT('automations');
  const initialDefaults = getDefaultTemplates('action');

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(1, t('createStep.validation.nameRequired'))
          .regex(/^[a-zA-Z_][a-zA-Z0-9_-]*$/, t('createStep.validation.nameFormat')),
        stepType: z.enum(['trigger', 'llm', 'condition', 'action', 'loop']),
        config: z.string(),
        nextSteps: z.string(),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setValue,
    watch,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      stepType: 'action',
      config: initialDefaults.config,
      nextSteps: '{}',
    },
  });

  const stepType = watch('stepType');
  const config = watch('config');
  const nextSteps = watch('nextSteps');

  // Update config template when step type changes
  useEffect(() => {
    const defaults = getDefaultTemplates(stepType);
    setValue('config', defaults.config);
  }, [stepType, setValue]);

  const onSubmit = async (data: FormData) => {
    // Parse JSON fields
    let parsedConfig: Doc<'wfStepDefs'>['config'] = {};
    let parsedNextSteps: Doc<'wfStepDefs'>['nextSteps'] = {};

    if (data.config.trim()) {
      try {
        parsedConfig = JSON.parse(data.config);
      } catch {
        toast({
          title: t('configuration.validation.invalidJson'),
          variant: 'destructive',
        });
        return;
      }
    }

    if (data.nextSteps.trim()) {
      try {
        parsedNextSteps = JSON.parse(data.nextSteps);
      } catch {
        toast({
          title: t('configuration.validation.invalidJson'),
          variant: 'destructive',
        });
        return;
      }
    }

    try {
      await onCreateStep({
        name: data.name.trim(),
        stepType: data.stepType,
        config: parsedConfig,
        nextSteps: parsedNextSteps,
      });

      // Reset form
      const defaults = getDefaultTemplates('action');
      reset({
        name: '',
        stepType: 'action',
        config: defaults.config,
        nextSteps: '{}',
      });

      onOpenChange(false);
    } catch (error) {
      console.error('Failed to create step:', error);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      onOpenChange(false);
      // Reset form when closing
      const defaults = getDefaultTemplates('action');
      reset({
        name: '',
        stepType: 'action',
        config: defaults.config,
        nextSteps: '{}',
      });
    }
  };

  const handleTypeChange = (value: string) => {
    setValue('stepType', value as Doc<'wfStepDefs'>['stepType']);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleClose}
      title={t('createStep.title')}
      description={t('createStep.description')}
      submitText={t('createStep.createButton')}
      submittingText={t('createStep.creating')}
      isSubmitting={isSubmitting}
      submitDisabled={!watch('name')?.trim()}
      onSubmit={handleSubmit(onSubmit)}
      large
    >
      <Input
        id="step-name"
        label={t('configuration.name')}
        required
        {...register('name')}
        placeholder={t('createStep.namePlaceholder')}
        disabled={isSubmitting}
        errorMessage={errors.name?.message}
      />

      <Select
        value={stepType}
        onValueChange={handleTypeChange}
        disabled={isSubmitting}
        label={t('createStep.type')}
        options={[
          { value: 'action', label: t('createStep.types.action') },
          { value: 'llm', label: t('createStep.types.llm') },
          { value: 'condition', label: t('createStep.types.condition') },
        ]}
      />

      <Stack gap={4}>
        <JsonInput
          id="step-config"
          label={t('createStep.configLabel')}
          value={config}
          onChange={(value) => setValue('config', value)}
          placeholder='{"key":"value"}'
          rows={4}
          disabled={isSubmitting}
          description={t('createStep.configDescription')}
        />

        <JsonInput
          id="step-next"
          label={t('createStep.nextStepsLabel')}
          value={nextSteps}
          onChange={(value) => setValue('nextSteps', value)}
          placeholder='{"onSuccess":"step-2","onFailure":"step-x"}'
          rows={3}
          disabled={isSubmitting}
          description={t('createStep.nextStepsDescription')}
        />
      </Stack>
    </FormDialog>
  );
}
