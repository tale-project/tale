'use client';

import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { useEffect, useRef } from 'react';

import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';

import { useWebsiteEditForm, WebsiteEditFields } from './website-edit-form';

interface EditWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  website: WebsiteDoc;
}

export function EditWebsiteDialog({
  isOpen,
  onClose,
  website,
}: EditWebsiteDialogProps) {
  const {
    tWebsites,
    errors,
    isDirty,
    isPending,
    seed,
    setValue,
    scanInterval,
    scanIntervalOptions,
    submit,
  } = useWebsiteEditForm(website, onClose);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) seed();
    wasOpen.current = isOpen;
  }, [isOpen, seed]);

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={() => onClose()}
      title={tWebsites('editWebsite')}
      isSubmitting={isPending}
      isDirty={isDirty}
      size="default"
      onSubmit={submit}
    >
      <WebsiteEditFields
        website={website}
        scanInterval={scanInterval}
        scanIntervalOptions={scanIntervalOptions}
        errors={errors}
        isPending={isPending}
        setValue={setValue}
      />
    </FormDialog>
  );
}
