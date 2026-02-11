'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useWebsiteCollection } from '../hooks/collections';
import { useCreateWebsite } from '../hooks/mutations';

type FormData = {
  domain: string;
  scanInterval: string;
};

interface AddWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
}

export function AddWebsiteDialog({
  isOpen,
  onClose,
  organizationId,
}: AddWebsiteDialogProps) {
  const { t: tWebsites } = useT('websites');
  const [isLoading, setIsLoading] = useState(false);
  const websiteCollection = useWebsiteCollection(organizationId);
  const createWebsite = useCreateWebsite(websiteCollection);

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
      domain: '',
      scanInterval: '6h',
    },
  });

  const scanInterval = watch('scanInterval');

  const onSubmit = async (data: FormData) => {
    setIsLoading(true);
    try {
      await createWebsite({
        organizationId,
        domain: data.domain,
        scanInterval: data.scanInterval,
      });

      toast({
        title: tWebsites('toast.addSuccess'),
        variant: 'success',
      });

      reset();
      onClose();
    } catch (error) {
      console.error('Failed to add website:', error);
      toast({
        title: tWebsites('toast.addError'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      title={tWebsites('addWebsite')}
      submittingText={tWebsites('adding')}
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
