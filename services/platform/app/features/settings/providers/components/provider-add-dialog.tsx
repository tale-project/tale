'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useSaveProvider } from '../hooks/mutations';

type FormData = {
  name: string;
  displayName: string;
  baseUrl: string;
};

interface ProviderAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export function ProviderAddDialog({
  open,
  onOpenChange,
  organizationId: _organizationId,
}: ProviderAddDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { mutateAsync: saveProvider } = useSaveProvider();

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(
            1,
            tCommon('validation.required', {
              field: t('providers.name'),
            }),
          )
          .regex(/^[a-z][a-z0-9-]*$/, t('providers.namePatternError')),
        displayName: z.string().min(
          1,
          tCommon('validation.required', {
            field: t('providers.displayName'),
          }),
        ),
        baseUrl: z.string().url(
          tCommon('validation.required', {
            field: t('providers.baseUrl'),
          }),
        ),
      }),
    [t, tCommon],
  );

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
    reset,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      displayName: '',
      baseUrl: '',
    },
  });

  const onSubmit = async (data: FormData) => {
    try {
      await saveProvider({
        orgSlug: 'default',
        providerName: data.name,
        config: {
          displayName: data.displayName,
          baseUrl: data.baseUrl,
          models: [
            {
              id: `${data.name}/default`,
              displayName: 'Default',
              tags: ['chat'],
              default: true,
            },
          ],
        },
      });
      toast({
        title: t('providers.created'),
        variant: 'success',
      });
      reset();
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast({
        title: t('providers.createFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) reset();
        onOpenChange(isOpen);
      }}
      title={t('providers.addProvider')}
      submitText={tCommon('actions.create')}
      submittingText={tCommon('actions.adding')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="name"
        label={t('providers.name')}
        {...register('name')}
        placeholder={t('providers.namePlaceholder')}
        errorMessage={errors.name?.message}
      />
      <Text variant="caption" className="-mt-2">
        {t('providers.nameHelp')}
      </Text>

      <Input
        id="displayName"
        label={t('providers.displayName')}
        {...register('displayName')}
        placeholder={t('providers.displayNamePlaceholder')}
        errorMessage={errors.displayName?.message}
      />

      <Input
        id="baseUrl"
        label={t('providers.baseUrl')}
        {...register('baseUrl')}
        placeholder={t('providers.baseUrlPlaceholder')}
        errorMessage={errors.baseUrl?.message}
      />
    </FormDialog>
  );
}
