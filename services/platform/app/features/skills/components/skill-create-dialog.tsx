'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { SKILL_NAME_REGEX } from '@/lib/shared/schemas/skills';

import { useCreateSkill } from '../hooks/mutations';

type FormData = {
  slug: string;
  description: string;
};

interface CreateSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** Called with the new slug after a successful create. */
  onCreated?: (slug: string) => void;
}

export function CreateSkillDialog({
  open,
  onOpenChange,
  organizationId,
  onCreated,
}: CreateSkillDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { mutateAsync: createSkill } = useCreateSkill();

  // Skill slugs follow agentskills.io spec: lowercase letters/digits,
  // hyphen-separated, no leading/trailing/consecutive hyphens, no
  // underscores. Stricter than agent's slug regex.
  const formSchema = useMemo(
    () =>
      z.object({
        slug: z
          .string()
          .min(
            1,
            tCommon('validation.required', {
              field: t('skills.form.slug', { defaultValue: 'Slug' }),
            }),
          )
          .max(64)
          .regex(
            SKILL_NAME_REGEX,
            t('skills.form.slugPatternError', {
              defaultValue:
                'Lowercase letters, digits, hyphen-separated. No underscores, no leading/trailing/consecutive hyphens.',
            }),
          ),
        description: z
          .string()
          .min(
            1,
            tCommon('validation.required', {
              field: t('skills.form.description', {
                defaultValue: 'Description',
              }),
            }),
          )
          .max(1024),
      }),
    [t, tCommon],
  );

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { isSubmitting, errors, isDirty, isValid },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { slug: '', description: '' },
    mode: 'onChange',
  });

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const onSubmit = async (data: FormData) => {
    try {
      await createSkill({
        organizationId,
        slug: data.slug,
        meta: {
          name: data.slug,
          description: data.description,
        },
        body: t('skills.bodyTemplate', {
          defaultValue:
            '## When to use\n\n## References\n\n## How the agent should approach this\n',
        }),
      });
      toast({
        title: t('skills.skillCreated', { defaultValue: 'Skill created' }),
        variant: 'success',
      });
      onOpenChange(false);
      onCreated?.(data.slug);
    } catch (error) {
      if (error instanceof ConvexError) {
        const code = error.data?.code;
        if (code === 'ALREADY_EXISTS') {
          setError('slug', {
            message: t('skills.skillAlreadyExists', {
              defaultValue: 'A skill with this slug already exists',
            }),
          });
          return;
        }
        if (
          code === 'INVALID_FRONTMATTER' ||
          code === 'INVALID_SLUG' ||
          code === 'NAME_MISMATCH'
        ) {
          toast({
            title:
              error.data?.message ??
              t('skills.validationError', {
                defaultValue: 'Invalid skill configuration',
              }),
            variant: 'destructive',
          });
          return;
        }
      }
      console.error(error);
      toast({
        title: t('skills.skillCreateFailed', {
          defaultValue: 'Failed to create skill',
        }),
        variant: 'destructive',
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('skills.createSkill', { defaultValue: 'Create skill' })}
      submitText={t('skills.createDialog.continue', {
        defaultValue: 'Create',
      })}
      submittingText={t('skills.createDialog.creating', {
        defaultValue: 'Creating…',
      })}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      isValid={isValid}
      confirmDiscardOnDirty
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="slug"
        label={t('skills.form.slug', { defaultValue: 'Slug' })}
        {...register('slug')}
        autoFocus
        placeholder="code-reviewer"
        errorMessage={errors.slug?.message}
      />
      <Text variant="caption" className="-mt-2">
        {t('skills.form.slugHelp', {
          defaultValue:
            'Lowercase letters/digits, hyphen-separated. Used as the on-disk folder name.',
        })}
      </Text>

      <Textarea
        id="description"
        label={t('skills.form.description', { defaultValue: 'Description' })}
        {...register('description')}
        placeholder={t('skills.form.descriptionPlaceholder', {
          defaultValue:
            'When this skill should be used — the agent sees this in every system prompt.',
        })}
        rows={4}
        errorMessage={errors.description?.message}
      />
      <Text variant="caption" className="-mt-2">
        {t('skills.form.descriptionHelp', {
          defaultValue:
            'Lead with "Use when…". The agent reads this to decide whether to expand the skill.',
        })}
      </Text>
    </FormDialog>
  );
}
