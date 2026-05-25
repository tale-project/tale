'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useCreateProject } from '../hooks/mutations';

type FormData = {
  name: string;
  description?: string;
};

interface ProjectCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export function ProjectCreateDialog({
  open,
  onOpenChange,
  organizationId,
}: ProjectCreateDialogProps) {
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const { mutateAsync: createProject } = useCreateProject();

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
        description: z.string().trim().max(500).optional(),
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
    defaultValues: { name: '', description: '' },
  });

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const onSubmit = async (data: FormData) => {
    try {
      const projectId = await createProject({
        organizationId,
        name: data.name,
        description: data.description || undefined,
      });
      toast({
        title: t('create.successToast'),
        variant: 'success',
      });
      onOpenChange(false);
      void navigate({
        to: '/dashboard/$id/projects/$projectId',
        params: { id: organizationId, projectId: String(projectId) },
      });
    } catch (error) {
      if (error instanceof ConvexError) {
        const code = error.data?.code;
        if (code === 'PROJECT_NAME_INVALID') {
          setError('name', { message: t('errors.PROJECT_NAME_INVALID') });
          return;
        }
        if (code === 'RBAC_FORBIDDEN') {
          toast({
            title: t('errors.RBAC_FORBIDDEN'),
            variant: 'destructive',
          });
          return;
        }
      }
      console.error('createProject failed', error);
      toast({
        title: t('create.errorToast'),
        variant: 'destructive',
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('create.title')}
      submitText={t('create.submit')}
      submittingText={t('create.submitting')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="project-name"
        label={t('create.nameLabel')}
        placeholder={t('create.namePlaceholder')}
        {...register('name')}
        errorMessage={errors.name?.message}
      />
      <Textarea
        id="project-description"
        label={t('create.descriptionLabel')}
        placeholder={t('create.descriptionPlaceholder')}
        rows={3}
        {...register('description')}
        errorMessage={errors.description?.message}
      />
    </FormDialog>
  );
}
