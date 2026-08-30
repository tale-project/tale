'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ConvexError } from 'convex/values';
import { useEffect, useMemo } from 'react';
import { z } from 'zod/v4';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { useForm } from '@/app/components/ui/forms/use-form';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useUpdateProjectIdentity } from '../hooks/mutations';

interface ProjectRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  currentName: string;
}

type FormData = { name: string };

export function ProjectRenameDialog({
  open,
  onOpenChange,
  projectId,
  currentName,
}: ProjectRenameDialogProps) {
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');
  const { mutateAsync: updateIdentity } = useUpdateProjectIdentity();

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(
            1,
            tCommon('validation.required', {
              field: t('create.nameLabel'),
            }),
          )
          .max(80, t('errors.PROJECT_NAME_INVALID')),
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
    defaultValues: { name: currentName },
  });

  useEffect(() => {
    if (open) reset({ name: currentName });
  }, [open, currentName, reset]);

  const onSubmit = async (data: FormData) => {
    if (data.name.trim() === currentName.trim()) {
      onOpenChange(false);
      return;
    }
    try {
      await updateIdentity({ projectId, name: data.name });
      toast({ title: t('create.successToast'), variant: 'success' });
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ConvexError) {
        const code = error.data?.code;
        if (code === 'PROJECT_NAME_INVALID') {
          setError('name', { message: t('errors.PROJECT_NAME_INVALID') });
          return;
        }
        if (code === 'RBAC_FORBIDDEN' || code === 'PROJECT_FORBIDDEN') {
          toast({
            title: t('errors.' + code, {
              defaultValue: t('settings.saveError'),
            }),
            variant: 'destructive',
          });
          return;
        }
      }
      console.error('rename project failed', error);
      toast({ title: t('settings.saveError'), variant: 'destructive' });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('rowActions.renameDialogTitle')}
      submitText={t('rowActions.renameSubmit')}
      submittingText={t('rowActions.renameSubmitting')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="project-rename-name"
        label={t('create.nameLabel')}
        autoFocus
        {...register('name')}
        errorMessage={errors.name?.message}
      />
    </FormDialog>
  );
}
