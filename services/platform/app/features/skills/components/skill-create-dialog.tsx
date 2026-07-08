'use client';

/**
 * "Blank" entry of the skills Add menu — name a slug, get a minimal valid
 * SKILL.md bundle (server-authored placeholder frontmatter + body) to edit
 * from the detail panel. Mirrors the agents `CreateAgentDialog` shape:
 * FormDialog + react-hook-form, validate-on-change, duplicate-slug errors
 * land on the name field.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Text } from '@tale/ui/text';
import { useEffect, useMemo } from 'react';
import { z } from 'zod/v4';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { useForm } from '@/app/components/ui/forms/use-form';
import { convexErrorCode } from '@/app/hooks/use-action-query';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { SKILL_NAME_REGEX } from '@/lib/shared/schemas/skills';

import { useCreateSkill } from '../hooks/mutations';

type FormData = {
  name: string;
};

export function SkillCreateDialog({
  open,
  onOpenChange,
  organizationId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** Called with the new slug once the bundle is on disk (deep-link target). */
  onCreated?: (slug: string) => void;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { mutateAsync: createSkill } = useCreateSkill();

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(
            1,
            tCommon('validation.required', {
              field: t('skills.createDialog.nameLabel'),
            }),
          )
          .max(64, t('skills.createDialog.namePatternError'))
          // The shared skill-slug alphabet (`lib/shared/schemas/skills.ts`) —
          // the server re-validates; this is the inline UX copy of the rule.
          .regex(SKILL_NAME_REGEX, t('skills.createDialog.namePatternError')),
      }),
    [t, tCommon],
  );

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { isSubmitting, errors, isValid },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '' },
  });

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const onSubmit = async (data: FormData) => {
    try {
      const result = await createSkill({ organizationId, slug: data.name });
      toast({ title: t('skills.createDialog.created'), variant: 'success' });
      onOpenChange(false);
      onCreated?.(result.slug);
    } catch (error) {
      if (convexErrorCode(error) === 'SKILL_EXISTS') {
        setError('name', { message: t('skills.createDialog.exists') });
        return;
      }
      console.error(error);
      toast({
        title: t('skills.createDialog.createFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('skills.createDialog.title')}
      submitText={t('skills.createDialog.submit')}
      submittingText={t('skills.createDialog.creating')}
      isSubmitting={isSubmitting}
      isValid={isValid}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="skill-name"
        label={t('skills.createDialog.nameLabel')}
        {...register('name')}
        placeholder={t('skills.createDialog.namePlaceholder')}
        errorMessage={errors.name?.message}
      />
      <Text variant="caption" className="-mt-2">
        {t('skills.createDialog.nameHelp')}
      </Text>
    </FormDialog>
  );
}
