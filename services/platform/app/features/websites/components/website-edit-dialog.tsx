'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { Select } from '@tale/ui/select';
import { useForm } from '@tale/ui/use-form';
import { toast } from '@tale/ui/use-toast';
import { type RefObject, useEffect, useMemo, useRef } from 'react';
import * as z from 'zod';

import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { useUpdateWebsite } from '../hooks/mutations';

type FormData = {
  scanInterval: string;
};

interface WebsiteEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  website: WebsiteDoc;
  /** Runs after a successful save, before the dialog closes. */
  onSaved?: () => void;
  /** Stable focus target when the opener (a row menu item) unmounts. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

export function WebsiteEditDialog({
  isOpen,
  onClose,
  website,
  onSaved,
  restoreFocusRef,
}: WebsiteEditDialogProps) {
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
    formState: { errors, isDirty },
    reset,
    setValue,
    watch,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      scanInterval: website.scanInterval,
    },
  });

  const scanInterval = watch('scanInterval');

  // Seed the form only on the open transition: re-seeding on every `website`
  // identity change would drop the user's pick whenever the list refetches
  // mid-edit (the table re-syncs scan statuses in the background).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      reset({ scanInterval: website.scanInterval });
    }
    wasOpen.current = isOpen;
  }, [isOpen, website.scanInterval, reset]);

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
          onSaved?.();
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
      description={tWebsites('editDescription')}
      isSubmitting={isLoading}
      isDirty={isDirty}
      onSubmit={handleSubmit(onSubmit)}
      size="entity"
      restoreFocusRef={restoreFocusRef}
    >
      <Input
        id="domain"
        label={tWebsites('domain')}
        value={website.domain}
        readOnly
      />

      <Select
        value={scanInterval}
        onValueChange={(value) =>
          setValue('scanInterval', value, { shouldDirty: true })
        }
        disabled={isLoading}
        id="scanInterval"
        label={tWebsites('scanInterval')}
        required
        error={!!errors.scanInterval}
        placeholder={tWebsites('scanIntervalPlaceholder')}
        options={SCAN_INTERVALS}
      />
    </FormDialog>
  );
}
