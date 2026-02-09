'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { toast } from '@/app/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useUpdateWebsite } from '../hooks/use-update-website';

type FormData = {
  domain: string;
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
  const [isLoading, setIsLoading] = useState(false);
  const updateWebsite = useUpdateWebsite();

  const formSchema = useMemo(
    () =>
      z.object({
        domain: z
          .string()
          .min(1, tWebsites('validation.domainRequired'))
          .url(tWebsites('validation.validUrl')),
        scanInterval: z
          .string()
          .min(1, tWebsites('validation.scanIntervalRequired')),
      }),
    [tWebsites],
  );

  const SCAN_INTERVALS = [
    { value: '60m', label: tWebsites('scanIntervals.1hour') },
    { value: '6h', label: tWebsites('scanIntervals.6hours') },
    { value: '12h', label: tWebsites('scanIntervals.12hours') },
    { value: '1d', label: tWebsites('scanIntervals.1day') },
    { value: '5d', label: tWebsites('scanIntervals.5days') },
    { value: '7d', label: tWebsites('scanIntervals.7days') },
    { value: '30d', label: tWebsites('scanIntervals.30days') },
  ];

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    watch,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      domain: website.domain,
      scanInterval: website.scanInterval,
    },
  });

  const scanInterval = watch('scanInterval');

  useEffect(() => {
    if (website) {
      reset({
        domain: website.domain,
        scanInterval: website.scanInterval,
      });
    }
  }, [website, reset]);

  const onSubmit = async (data: FormData) => {
    setIsLoading(true);
    try {
      await updateWebsite({
        websiteId: website._id,
        domain: data.domain,
        scanInterval: data.scanInterval,
      });

      toast({
        title: tWebsites('toast.updateSuccess'),
        variant: 'success',
      });

      onClose();
    } catch (error) {
      console.error('Failed to update website:', error);
      toast({
        title: tWebsites('toast.updateError'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={() => onClose()}
      title={tWebsites('editWebsite')}
      isSubmitting={isLoading}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="domain"
        type="url"
        label={tWebsites('domain')}
        placeholder={tWebsites('urlPlaceholder')}
        {...register('domain')}
        disabled={isLoading}
        errorMessage={errors.domain?.message}
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
