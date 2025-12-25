'use client';

import { useMemo } from 'react';
import { FormModal } from '@/components/ui/modals';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@/hooks/use-toast';
import { useCreateAutomation } from '../hooks';
import { useT } from '@/lib/i18n';

type FormData = {
  name: string;
  description?: string;
};

interface CreateAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export default function CreateAutomationDialog({
  open,
  onOpenChange,
  organizationId,
}: CreateAutomationDialogProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');

  const formSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, tCommon('validation.required', { field: t('form.name') })),
        description: z.string().optional(),
      }),
    [t, tCommon],
  );

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, isValid },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
  });
  const router = useRouter();

  const createAutomation = useCreateAutomation();

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
      router.push(`/dashboard/${organizationId}/automations/${wfDefinitionId}`);
    } catch {
      toast({
        title: t('toast.createFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      title={t('createDialog.title')}
      submitText={t('createDialog.continue')}
      submittingText={t('createDialog.creating')}
      isSubmitting={isSubmitting}
      submitDisabled={!isValid}
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="space-y-2">
        <Label htmlFor="name">{t('configuration.name')}</Label>
        <Input
          id="name"
          {...register('name')}
          placeholder={t('createDialog.namePlaceholder')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">
          {t('configuration.description')}{' '}
          <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="description"
          {...register('description')}
          placeholder={t('createDialog.descriptionPlaceholder')}
          rows={3}
        />
      </div>
    </FormModal>
  );
}
