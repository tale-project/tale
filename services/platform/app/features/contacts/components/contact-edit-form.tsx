'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from '@tale/ui/use-form';
import { toast } from '@tale/ui/use-toast';
import { useCallback } from 'react';

import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { useUpdateContact } from '../hooks/mutations';
import {
  type ContactFormValues,
  useContactFormSchema,
} from '../hooks/use-contact-form';

export const CONTACT_EDIT_FORM_ID = 'contact-edit';

export function contactFormValues(contact: ContactDoc): ContactFormValues {
  return {
    name: contact.name || '',
    email: contact.email || '',
    phone: contact.phone || '',
    locale: contact.locale || 'en',
  };
}

export function useContactEditForm(contact: ContactDoc, onSaved: () => void) {
  const { t: tContacts } = useT('contacts');
  const { mutateAsync: updateContact } = useUpdateContact();
  const formSchema = useContactFormSchema();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<ContactFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: contactFormValues(contact),
  });

  const seed = useCallback(() => {
    reset(contactFormValues(contact));
  }, [contact, reset]);

  const submit = handleSubmit(async (data) => {
    try {
      await updateContact({
        contactId: contact._id,
        // Send the trimmed value as-is (including `''`) rather than
        // `|| undefined` — `updateContact` drops `undefined` args as
        // "unchanged", so `undefined` here would silently skip patching a
        // field the user just cleared.
        name: data.name.trim(),
        email: data.email.trim(),
        phone: data.phone.trim(),
        locale: data.locale,
      });

      toast({
        title: tContacts('updateSuccess'),
        variant: 'success',
      });
      onSaved();
    } catch (error) {
      console.error('Update error:', error);
      toast({
        title: tContacts('updateError'),
        variant: 'destructive',
      });
    }
  });

  return { register, errors, isSubmitting, isDirty, reset, seed, submit };
}
