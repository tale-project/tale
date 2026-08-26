'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import { useEffect, useMemo, useRef } from 'react';
import { z } from 'zod/v4';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useForm } from '@/app/components/ui/forms/use-form';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import {
  deriveProjectKey,
  isValidProjectKey,
  normalizeProjectKey,
} from '@/lib/shared/project_key';

import { useCreateProject } from '../hooks/mutations';

type FormData = {
  name: string;
  key: string;
  description?: string;
};

interface ProjectCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /**
   * Called with the new project's id right after creation (before the dialog
   * navigates to it). Lets a caller record local UI state for the new project
   * — e.g. the chat sidebar pre-expands its folder.
   */
  onCreated?: (projectId: Id<'projects'>) => void;
  /**
   * Navigate to the new project's detail page after creation (default `true`).
   * Set `false` when the caller drives its own follow-up navigation — e.g. the
   * app-install flow creates a project, then routes into the app under it.
   */
  navigateOnCreate?: boolean;
}

export function ProjectCreateDialog({
  open,
  onOpenChange,
  organizationId,
  onCreated,
  navigateOnCreate = true,
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
        key: z
          .string()
          .trim()
          .refine((value) => isValidProjectKey(normalizeProjectKey(value)), {
            message: t('errors.PROJECT_KEY_INVALID'),
          }),
        description: z.string().trim().max(500).optional(),
      }),
    [t, tCommon],
  );

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', key: '', description: '' },
  });

  // The key auto-tracks the name (e.g. "Tale Platform" → "TAL") until the user
  // types in the key field — after that it's theirs to control.
  const keyEditedRef = useRef(false);
  const name = watch('name');
  useEffect(() => {
    if (!keyEditedRef.current) {
      setValue('key', deriveProjectKey(name), { shouldValidate: false });
    }
  }, [name, setValue]);

  useEffect(() => {
    if (!open) {
      reset();
      keyEditedRef.current = false;
    }
  }, [open, reset]);

  const keyField = register('key');

  const onSubmit = async (data: FormData) => {
    try {
      const projectId = await createProject({
        organizationId,
        name: data.name,
        key: normalizeProjectKey(data.key),
        description: data.description || undefined,
      });
      toast({
        title: t('create.successToast'),
        variant: 'success',
      });
      onCreated?.(projectId);
      onOpenChange(false);
      if (navigateOnCreate) {
        void navigate({
          to: '/dashboard/$id/projects/$projectId/tasks',
          params: { id: organizationId, projectId: String(projectId) },
        });
      }
    } catch (error) {
      if (error instanceof ConvexError) {
        const code = error.data?.code;
        if (code === 'PROJECT_NAME_INVALID') {
          setError('name', { message: t('errors.PROJECT_NAME_INVALID') });
          return;
        }
        if (code === 'PROJECT_KEY_INVALID') {
          setError('key', { message: t('errors.PROJECT_KEY_INVALID') });
          return;
        }
        if (code === 'PROJECT_KEY_TAKEN') {
          setError('key', { message: t('errors.PROJECT_KEY_TAKEN') });
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
        required
        {...register('name')}
        errorMessage={errors.name?.message}
      />
      <Input
        id="project-key"
        label={t('create.keyLabel')}
        hint={t('create.keyDescription')}
        placeholder="TAL"
        maxLength={6}
        autoComplete="off"
        required
        {...keyField}
        onChange={(e) => {
          keyEditedRef.current = true;
          e.target.value = normalizeProjectKey(e.target.value);
          void keyField.onChange(e);
        }}
        errorMessage={errors.key?.message}
      />
      <Textarea
        id="project-description"
        label={t('create.descriptionLabel')}
        placeholder={t('create.descriptionPlaceholder')}
        required={false}
        rows={3}
        {...register('description')}
        errorMessage={errors.description?.message}
      />
    </FormDialog>
  );
}
