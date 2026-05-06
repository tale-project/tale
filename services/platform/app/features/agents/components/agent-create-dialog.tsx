'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Text } from '@/app/components/ui/typography/text';
import { useListProviders } from '@/app/features/settings/providers/hooks/queries';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useSaveAgent } from '../hooks/mutations';

type FormData = {
  name: string;
  displayName: string;
  description?: string;
};

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export function CreateAgentDialog({
  open,
  onOpenChange,
  organizationId,
}: CreateAgentDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const { mutateAsync: saveAgent } = useSaveAgent();
  const { providers } = useListProviders('default');

  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [modelSelectOpen, setModelSelectOpen] = useState(false);

  const modelOptions = useMemo(() => {
    const allModels: {
      id: string;
      displayName: string;
      providerName: string;
    }[] = [];
    for (const provider of providers) {
      if (
        !provider ||
        !('models' in provider) ||
        !Array.isArray(provider.models)
      )
        continue;
      for (const model of provider.models) {
        allModels.push({
          id: model.id,
          displayName: model.displayName,
          providerName: provider.name,
        });
      }
    }
    return allModels.map((m) => ({
      // Qualified form pins routing to this exact provider.
      value: `${m.providerName}:${m.id}`,
      label: m.displayName,
      description: t('agents.form.viaProvider', {
        provider: m.providerName,
        defaultValue: `via ${m.providerName}`,
      }),
    }));
  }, [providers, t]);

  // Auto-select first model when providers load and no selection exists
  useEffect(() => {
    if (!selectedModelId && modelOptions.length > 0) {
      setSelectedModelId(modelOptions[0].value);
    }
  }, [selectedModelId, modelOptions]);

  const handleModelChange = useCallback((value: string) => {
    setSelectedModelId(value);
    setModelSelectOpen(false);
  }, []);

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(
            1,
            tCommon('validation.required', {
              field: t('agents.form.name'),
            }),
          )
          .regex(/^[a-z0-9][a-z0-9_-]*$/, t('agents.form.namePatternError')),
        displayName: z.string().min(
          1,
          tCommon('validation.required', {
            field: t('agents.form.displayName'),
          }),
        ),
        description: z.string().optional(),
      }),
    [t, tCommon],
  );

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { isSubmitting, errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      displayName: '',
      description: '',
    },
  });

  useEffect(() => {
    if (!open) {
      reset();
      setSelectedModelId(null);
    }
  }, [open, reset]);

  const onSubmit = async (data: FormData) => {
    const modelId = selectedModelId ?? modelOptions[0]?.value;
    if (!modelId) return;

    try {
      await saveAgent({
        orgSlug: 'default',
        agentName: data.name,
        isNew: true,
        config: {
          displayName: data.displayName,
          description: data.description,
          systemInstructions: 'You are a helpful assistant.',
          supportedModels: [modelId],
        },
      });
      toast({
        title: t('agents.agentCreated'),
        variant: 'success',
      });
      void navigate({
        to: '/dashboard/$id/agents/$agentId',
        params: { id: organizationId, agentId: data.name },
      });
    } catch (error) {
      if (error instanceof ConvexError) {
        const code = error.data?.code;
        if (code === 'DUPLICATE_NAME') {
          setError('name', { message: t('agents.agentAlreadyExists') });
          return;
        }
        if (code === 'UNKNOWN_PROVIDER' || code === 'UNKNOWN_MODEL') {
          toast({
            title: error.data?.message ?? t('agents.agentCreateFailed'),
            variant: 'destructive',
          });
          return;
        }
        if (code === 'VALIDATION_ERROR') {
          toast({
            title:
              error.data?.message ??
              t('agents.validationError', {
                defaultValue: 'Invalid agent configuration',
              }),
            variant: 'destructive',
          });
          return;
        }
      }
      console.error(error);
      toast({
        title: t('agents.agentCreateFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('agents.createAgent')}
      submitText={t('agents.createDialog.continue')}
      submittingText={t('agents.createDialog.creating')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="name"
        label={t('agents.form.name')}
        {...register('name')}
        placeholder={t('agents.form.namePlaceholder')}
        errorMessage={errors.name?.message}
      />
      <Text variant="caption" className="-mt-2">
        {t('agents.form.nameHelp')}
      </Text>

      <Input
        id="displayName"
        label={t('agents.form.displayName')}
        {...register('displayName')}
        placeholder={t('agents.form.displayNamePlaceholder')}
        errorMessage={errors.displayName?.message}
      />

      <Textarea
        id="description"
        label={t('agents.form.description')}
        {...register('description')}
        placeholder={t('agents.form.descriptionPlaceholder')}
        rows={3}
      />

      <SearchableSelect
        id="model-select"
        label={t('agents.createDialog.model')}
        placeholder={t('agents.createDialog.modelPlaceholder')}
        value={selectedModelId}
        onValueChange={handleModelChange}
        options={modelOptions}
        open={modelSelectOpen}
        onOpenChange={setModelSelectOpen}
        searchPlaceholder={t('agents.createDialog.modelSearch')}
        emptyText={t('agents.createDialog.modelEmpty')}
        aria-label={t('agents.createDialog.model')}
      />
    </FormDialog>
  );
}
