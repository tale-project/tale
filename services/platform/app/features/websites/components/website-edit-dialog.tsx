'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { toast } from '@/app/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useUpdateWebsite } from '../hooks/mutations';

type FormData = {
  scanInterval: string;
};

interface EditWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  website: Doc<'websites'>;
}

export function EditWebsiteDialog({
  isOpen,
  onClose,
  website,
}: EditWebsiteDialogProps) {
  const { t: tWebsites } = useT('websites');
  const { mutate: updateWebsite, isPending: isLoading } = useUpdateWebsite();

  const formSchema = useMemo(
    () =>
      z.object({
        scanInterval: z
          .string()
          .min(1, tWebsites('validation.scanIntervalRequired')),
      }),
    [tWebsites],
  );

  const SCAN_INTERVALS = useMemo(
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
    formState: { errors, isValid },
    reset,
    setValue,
    watch,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      scanInterval: website.scanInterval,
    },
  });

  const scanInterval = watch('scanInterval');

  useEffect(() => {
    if (website) {
      reset({
        scanInterval: website.scanInterval,
      });
    }
  }, [website, reset]);

  const onSubmit = (data: FormData) => {
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
          onClose();
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
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={() => onClose()}
      title={tWebsites('editWebsite')}
      isSubmitting={isLoading}
      isValid={isValid}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="domain"
        label={tWebsites('domain')}
        value={website.domain}
        disabled
      />

      <Select
        value={scanInterval}
        onValueChange={(value) => setValue('scanInterval', value)}
        disabled={isLoading}
        id="scanInterval"
        label={tWebsites('scanInterval')}
        error={!!errors.scanInterval}
        placeholder={tWebsites('scanIntervalPlaceholder')}
        options={SCAN_INTERVALS}
      />
    </FormDialog>
  );
}
