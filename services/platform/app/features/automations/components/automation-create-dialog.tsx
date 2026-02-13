'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useCreateAutomation } from '../hooks/mutations';

type FormData = {
  name: string;
  description?: string;
};

interface CreateAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export function CreateAutomationDialog({
  open,
  onOpenChange,
  organizationId,
}: CreateAutomationDialogProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(1, tCommon('validation.required', { field: t('form.name') })),
        description: z.string().optional(),
      }),
    [t, tCommon],
  );

  const {
    register,
    handleSubmit,
    setError,
    formState: { isSubmitting, isValid, errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
  });
  const navigate = useNavigate();

  const { mutateAsync: createAutomation } = useCreateAutomation();

  const onSubmit = async (data: FormData) => {
    try {
      const { workflowId: wfDefinitionId } = await createAutomation({
        organizationId,
        workflowConfig: {
          name: data.name,
          description: data.description,
          config: {},
        },
        stepsConfig: [],
      });
      toast({
        title: t('toast.created'),
        variant: 'success',
      });
      void navigate({
        to: '/dashboard/$id/automations/$amId',
        params: { id: organizationId, amId: wfDefinitionId },
        search: { panel: 'ai-chat' },
      });
    } catch (error) {
      if (
        error instanceof ConvexError &&
        error.data?.code === 'DUPLICATE_NAME'
      ) {
        setError('name', { message: t('validation.duplicateName') });
        return;
      }
      toast({
        title: t('toast.createFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('createDialog.title')}
      submitText={t('createDialog.continue')}
      submittingText={t('createDialog.creating')}
      isSubmitting={isSubmitting}
      submitDisabled={!isValid}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="name"
        label={t('configuration.name')}
        {...register('name')}
        placeholder={t('createDialog.namePlaceholder')}
        errorMessage={errors.name?.message}
      />

      <Textarea
        id="description"
        label={t('configuration.description')}
        {...register('description')}
        placeholder={t('createDialog.descriptionPlaceholder')}
        rows={3}
      />
    </FormDialog>
  );
}
