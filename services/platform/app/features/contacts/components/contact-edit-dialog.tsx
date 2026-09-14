'use client';

import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { useEffect, useRef } from 'react';

import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { useContactEditForm } from './contact-edit-form';
import { ContactFormFields } from './contact-form-fields';

interface ContactEditDialogProps {
  contact: ContactDoc;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  asChild?: boolean;
}

export function ContactEditDialog({
  contact,
  isOpen,
  onOpenChange,
}: ContactEditDialogProps) {
  const { t: tContacts } = useT('contacts');
  const { register, errors, isSubmitting, isDirty, seed, submit } =
    useContactEditForm(contact, () => onOpenChange(false));

  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) seed();
    wasOpen.current = isOpen;
  }, [isOpen, seed]);

  const handleOpenChange = (open: boolean) => {
    if (!open) seed();
    onOpenChange(open);
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      title={tContacts('editContact')}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      onSubmit={submit}
    >
      <ContactFormFields
        register={register}
        errors={errors}
        disabled={isSubmitting}
      />
    </FormDialog>
  );
}
