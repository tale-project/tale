'use client';

/**
 * "From template" entry of the skills Add menu — pick a built-in catalog
 * skill (`TALE_CONFIG_BUILTIN_DIR/skills/*`) and copy its whole bundle into
 * the org under a new slug. The name prefills from the picked template and
 * stays editable, so a template can be instantiated next to the built-in
 * copy the sync manages.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { Text } from '@tale/ui/text';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod/v4';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { useForm } from '@/app/components/ui/forms/use-form';
import { convexErrorCode } from '@/app/hooks/use-action-query';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { SKILL_NAME_REGEX } from '@/lib/shared/schemas/skills';

import { useCreateSkill } from '../hooks/mutations';
import { useListCatalogSkills } from '../hooks/queries';

type FormData = {
  name: string;
};

export function SkillTemplateDialog({
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
  // Only fetch the catalog while the dialog is open — it's a file walk.
  const { templates, isLoading } = useListCatalogSkills(organizationId, open);
  const [templateSlug, setTemplateSlug] = useState('');

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
          .regex(SKILL_NAME_REGEX, t('skills.createDialog.namePatternError')),
      }),
    [t, tCommon],
  );

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    formState: { isSubmitting, errors, isValid, dirtyFields },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '' },
  });

  useEffect(() => {
    if (!open) {
      reset();
      setTemplateSlug('');
    }
  }, [open, reset]);

  const selectedTemplate = templates.find((tpl) => tpl.slug === templateSlug);

  const handleTemplateChange = (slug: string) => {
    setTemplateSlug(slug);
    // Prefill the name from the template until the user edits it themselves.
    if (!dirtyFields.name) {
      setValue('name', slug, { shouldValidate: true });
    }
  };

  const onSubmit = async (data: FormData) => {
    if (templateSlug === '') return;
    try {
      const result = await createSkill({
        organizationId,
        slug: data.name,
        templateSlug,
      });
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
      title={t('skills.templateDialog.title')}
      description={t('skills.templateDialog.description')}
      submitText={t('skills.createDialog.submit')}
      submittingText={t('skills.createDialog.creating')}
      isSubmitting={isSubmitting}
      isValid={isValid && templateSlug !== ''}
      onSubmit={handleSubmit(onSubmit)}
    >
      {!isLoading && templates.length === 0 ? (
        <Text variant="muted">{t('skills.templateDialog.empty')}</Text>
      ) : (
        <Select
          id="skill-template"
          label={t('skills.templateDialog.templateLabel')}
          placeholder={t('skills.templateDialog.templatePlaceholder')}
          options={templates.map((tpl) => ({
            value: tpl.slug,
            label: tpl.name,
          }))}
          value={templateSlug === '' ? undefined : templateSlug}
          onValueChange={handleTemplateChange}
          disabled={isLoading}
          description={selectedTemplate?.description}
        />
      )}

      <Input
        id="skill-template-name"
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
