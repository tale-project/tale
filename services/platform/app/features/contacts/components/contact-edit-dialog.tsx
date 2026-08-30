'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { useForm } from '@/app/components/ui/forms/use-form';
import { toast } from '@/app/hooks/use-toast';
import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { useUpdateContact } from '../hooks/mutations';
import {
  type ContactFormValues,
  useContactFormSchema,
} from '../hooks/use-contact-form';
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
  const { mutateAsync: updateContact } = useUpdateContact();
  const formSchema = useContactFormSchema();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<ContactFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: contact.name || '',
      email: contact.email || '',
      phone: contact.phone || '',
      locale: contact.locale || 'en',
    },
  });

  useEffect(() => {
    reset({
      name: contact.name || '',
      email: contact.email || '',
      phone: contact.phone || '',
      locale: contact.locale || 'en',
    });
  }, [contact, reset]);

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

      onOpenChange(false);
    } catch (error) {
      console.error('Update error:', error);
      toast({
        title: tContacts('updateError'),
        variant: 'destructive',
      });
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      reset();
    }
    onOpenChange(open);
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      title={tContacts('editContact')}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      onSubmit={handleSubmit(onSubmit)}
    >
      <ContactFormFields
        register={register}
        errors={errors}
        disabled={isSubmitting}
      />
    </FormDialog>
  );
}
