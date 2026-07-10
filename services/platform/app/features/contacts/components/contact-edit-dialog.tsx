'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { useForm } from '@/app/components/ui/forms/use-form';
import { toast } from '@/app/hooks/use-toast';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useUpdateContact } from '../hooks/mutations';

const LOCALE_PATTERN = /^[a-z]{2}(?:[-_][A-Za-z]{2,})?$/;

type ContactFormData = {
  name: string;
  email: string;
  phone: string;
  locale: string;
};

interface ContactEditDialogProps {
  contact: Doc<'contacts'>;
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
  const { t: tCommon } = useT('common');
  const { mutateAsync: updateContact } = useUpdateContact();

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, tCommon('validation.required', { field: tContacts('name') })),
        email: z.string().email(tCommon('validation.email')),
        phone: z.string(),
        locale: z
          .string()
          .min(
            1,
            tCommon('validation.required', { field: tContacts('locale') }),
          )
          .regex(
            LOCALE_PATTERN,
            tCommon('validation.required', { field: tContacts('locale') }),
          ),
      }),
    [tContacts, tCommon],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<ContactFormData>({
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

  const onSubmit = async (data: ContactFormData) => {
    try {
      await updateContact({
        contactId: contact._id,
        name: data.name.trim(),
        email: data.email.trim(),
        phone: data.phone.trim() || undefined,
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
      <Input
        id="name"
        label={tContacts('name')}
        placeholder={tContacts('namePlaceholder')}
        {...register('name')}
        disabled={isSubmitting}
        errorMessage={errors.name?.message}
        required
      />

      <Input
        id="email"
        type="email"
        label={tContacts('email')}
        placeholder={tContacts('emailPlaceholder')}
        {...register('email')}
        disabled={isSubmitting}
        errorMessage={errors.email?.message}
        required
      />

      <Input
        id="phone"
        label={tContacts('phone')}
        {...register('phone')}
        disabled={isSubmitting}
        errorMessage={errors.phone?.message}
      />

      <Input
        id="locale"
        label={tContacts('locale')}
        placeholder={tContacts('localePlaceholder')}
        {...register('locale')}
        disabled={isSubmitting}
        errorMessage={errors.locale?.message}
        required
      />
    </FormDialog>
  );
}
