'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Input } from '@tale/ui/input';
import { Select } from '@tale/ui/select';
import { useForm } from '@tale/ui/use-form';
import { toast } from '@tale/ui/use-toast';
import { useCallback, useMemo } from 'react';
import * as z from 'zod';

import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { useUpdateWebsite } from '../hooks/mutations';

export const WEBSITE_EDIT_FORM_ID = 'website-edit';

type FormData = {
  scanInterval: string;
};

export function useWebsiteEditForm(website: WebsiteDoc, onSaved: () => void) {
  const { t: tWebsites } = useT('websites');
  const { mutate: updateWebsite, isPending } = useUpdateWebsite();

  const formSchema = useMemo(
    () =>
      z.object({
        scanInterval: z
          .string()
          .min(1, tWebsites('validation.scanIntervalRequired')),
      }),
    [tWebsites],
  );

  const scanIntervalOptions = useMemo(
    () => [
      { value: '60m', label: tWebsites('scanIntervals.1hour') },
      { value: '6h', label: tWebsites('scanIntervals.6hours') },
      { value: '12h', label: tWebsites('scanIntervals.12hours') },
      { value: '1d', label: tWebsites('scanIntervals.1day') },
      { value: '5d', label: tWebsites('scanIntervals.5days') },
      { value: '7d', label: tWebsites('scanIntervals.7days') },
      { value: '30d', label: tWebsites('scanIntervals.30days') },
    ],
    [tWebsites],
  );

  const {
    handleSubmit,
    formState: { errors, isDirty },
    reset,
    setValue,
    watch,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { scanInterval: website.scanInterval },
  });

  const scanInterval = watch('scanInterval');
  const seed = useCallback(() => {
    reset({ scanInterval: website.scanInterval });
  }, [reset, website.scanInterval]);

  const submit = handleSubmit((data) => {
    updateWebsite(
      {
        websiteId: website._id,
        scanInterval: data.scanInterval,
      },
      {
        onSuccess: () => {
          toast({
            title: tWebsites('toast.updateSuccess'),
            variant: 'success',
          });
          onSaved();
        },
        onError: (error) => {
          console.error('Failed to update website:', error);
          toast({
            title: tWebsites('toast.updateError'),
            variant: 'destructive',
          });
        },
      },
    );
  });

  return {
    tWebsites,
    errors,
    isDirty,
    isPending,
    reset,
    seed,
    setValue,
    scanInterval,
    scanIntervalOptions,
    submit,
  };
}

export function WebsiteEditFields({
  website,
  scanInterval,
  scanIntervalOptions,
  errors,
  isPending,
  setValue,
}: {
  website: WebsiteDoc;
  scanInterval: string;
  scanIntervalOptions: ReturnType<
    typeof useWebsiteEditForm
  >['scanIntervalOptions'];
  errors: ReturnType<typeof useWebsiteEditForm>['errors'];
  isPending: boolean;
  setValue: ReturnType<typeof useWebsiteEditForm>['setValue'];
}) {
  const { t: tWebsites } = useT('websites');

  return (
    <>
      {/* Domain is identity, not an editable field. Native `disabled` so
          it still looks like an input (filled muted surface, same border)
          rather than a copyable read-only or an opacity wash. */}
      <Input
        id="domain"
        label={tWebsites('domain')}
        value={website.domain}
        disabled
      />

      <Select
        value={scanInterval}
        onValueChange={(value) =>
          setValue('scanInterval', value, { shouldDirty: true })
        }
        disabled={isPending}
        id="scanInterval"
        label={tWebsites('scanInterval')}
        required
        error={!!errors.scanInterval}
        placeholder={tWebsites('scanIntervalPlaceholder')}
        options={scanIntervalOptions}
      />
    </>
  );
}
