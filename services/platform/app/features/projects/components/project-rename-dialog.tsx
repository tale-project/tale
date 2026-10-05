'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { useForm } from '@tale/ui/use-form';
import { toast } from '@tale/ui/use-toast';
import { useEffect, useMemo, useRef } from 'react';
import { z } from 'zod/v4';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';
import { AppError } from '@/lib/shared/errors/app-error';

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
    getFieldState,
    formState: { isSubmitting, errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: currentName },
  });

  // The draft starts from the project's name when the dialog opens or turns to
  // another project. A rename from elsewhere while it is open (the row's live
  // `currentName`) only moves an untouched field: what the user has typed is
  // never replaced behind their back (#3916).
  const draftProjectId = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      draftProjectId.current = null;
      return;
    }
    if (draftProjectId.current === projectId && getFieldState('name').isDirty) {
      return;
    }
    draftProjectId.current = projectId;
    reset({ name: currentName });
  }, [open, projectId, currentName, reset, getFieldState]);

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
      if (error instanceof AppError) {
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
      toast({
        title: t('settings.saveError'),
        description: failureDetail(error),
        variant: 'destructive',
      });
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
