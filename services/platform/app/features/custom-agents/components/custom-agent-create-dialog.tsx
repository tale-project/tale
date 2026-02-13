'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useCreateCustomAgent } from '../hooks/mutations';

type FormData = {
  name: string;
  displayName: string;
  description?: string;
};

interface CreateCustomAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export function CreateCustomAgentDialog({
  open,
  onOpenChange,
  organizationId,
}: CreateCustomAgentDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const { mutateAsync: createAgent } = useCreateCustomAgent();

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(
            1,
            tCommon('validation.required', {
              field: t('customAgents.form.name'),
            }),
          )
          .regex(
            /^[a-z0-9][a-z0-9-]*$/,
            t('customAgents.form.namePatternError'),
          ),
        displayName: z.string().min(
          1,
          tCommon('validation.required', {
            field: t('customAgents.form.displayName'),
          }),
        ),
        description: z.string().optional(),
      }),
    [t, tCommon],
  );

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, isValid, errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
      displayName: '',
      description: '',
    },
  });

  const onSubmit = async (data: FormData) => {
    try {
      const agentId = await createAgent({
        organizationId,
        name: data.name,
        displayName: data.displayName,
        description: data.description,
        systemInstructions: 'You are a helpful assistant.',
        toolNames: [],
        modelPreset: 'standard',
        includeOrgKnowledge: false,
      });
      toast({
        title: t('customAgents.agentCreated'),
        variant: 'success',
      });
      void navigate({
        to: '/dashboard/$id/custom-agents/$agentId',
        params: { id: organizationId, agentId: String(agentId) },
      });
    } catch (error) {
      console.error(error);
      toast({
        title: t('customAgents.agentCreateFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('customAgents.createAgent')}
      submitText={t('customAgents.createDialog.continue')}
      submittingText={t('customAgents.createDialog.creating')}
      isSubmitting={isSubmitting}
      submitDisabled={!isValid}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="name"
        label={t('customAgents.form.name')}
        {...register('name')}
        placeholder={t('customAgents.form.namePlaceholder')}
        errorMessage={errors.name?.message}
      />
      <p className="text-muted-foreground -mt-2 text-xs">
        {t('customAgents.form.nameHelp')}
      </p>

      <Input
        id="displayName"
        label={t('customAgents.form.displayName')}
        {...register('displayName')}
        placeholder={t('customAgents.form.displayNamePlaceholder')}
        errorMessage={errors.displayName?.message}
      />

      <Textarea
        id="description"
        label={t('customAgents.form.description')}
        {...register('description')}
        placeholder={t('customAgents.form.descriptionPlaceholder')}
        rows={3}
      />
    </FormDialog>
  );
}
