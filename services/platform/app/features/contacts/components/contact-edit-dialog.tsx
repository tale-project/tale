'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { useForm } from '@tale/ui/use-form';
import { toast } from '@tale/ui/use-toast';
import { type RefObject, useEffect, useRef } from 'react';

import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { useUpdateContact } from '../hooks/mutations';
import {
  type ContactFormValues,
  useContactFormSchema,
} from '../hooks/use-contact-form';
import { ContactFormFields } from './contact-form-fields';

interface ContactEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  contact: ContactDoc;
  /** Runs after a successful save, before the dialog closes. */
  onSaved?: () => void;
  /** Stable focus target when the opener (a row menu item) unmounts. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

function toFormValues(contact: ContactDoc): ContactFormValues {
  return {
    name: contact.name || '',
    email: contact.email || '',
    phone: contact.phone || '',
    locale: contact.locale || 'en',
  };
}

export function ContactEditDialog({
  isOpen,
  onClose,
  contact,
  onSaved,
  restoreFocusRef,
}: ContactEditDialogProps) {
  const { t: tContacts } = useT('contacts');
  const { mutateAsync: updateContact } = useUpdateContact();
  const formSchema = useContactFormSchema();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
    setError,
    clearErrors,
  } = useForm<ContactFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(contact),
  });

  // Seed the form only on the open transition: re-seeding on every `contact`
  // identity change would wipe what the user typed whenever the list
  // refetches mid-edit.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      reset(toFormValues(contact));
    }
    wasOpen.current = isOpen;
  }, [isOpen, contact, reset]);

  const onSubmit = async (data: ContactFormValues) => {
    try {
      await updateContact({
        contactId: contact._id,
        // Send the trimmed value as-is (including `''`) rather than
        // `|| undefined` — `updateContact` drops `undefined` args as
        // "unchanged" (see `convex/contacts/update_contact.ts`'s
        // `cleanUpdateData` filter), so `undefined` here would silently skip
        // patching a field the user just cleared, leaving the old value in
        // place behind a misleading success toast. Name is optional
        // (#2640); Phone always was — both must be clearable.
        name: data.name.trim(),
        email: data.email.trim(),
        phone: data.phone.trim(),
        locale: data.locale,
      });

      toast({
        title: tContacts('updateSuccess'),
        variant: 'success',
      });

      onSaved?.();
      onClose();
    } catch (error) {
      console.error('Update error:', error);
      toast({
        title: tContacts('updateError'),
        variant: 'destructive',
      });
    }
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={tContacts('editContact')}
      description={tContacts('editDescription')}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      onSubmit={handleSubmit(onSubmit)}
      size="entity"
      restoreFocusRef={restoreFocusRef}
    >
      <ContactFormFields
        register={register}
        errors={errors}
        setError={setError}
        clearErrors={clearErrors}
        disabled={isSubmitting}
      />
    </FormDialog>
  );
}
