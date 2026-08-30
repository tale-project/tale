'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { useForm } from '@/app/components/ui/forms/use-form';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { backendErrorCode } from '@/lib/utils/backend-error';

import { useCreateContact } from '../hooks/mutations';
import {
  type ContactFormValues,
  useContactFormSchema,
} from '../hooks/use-contact-form';
import { ContactFormFields } from './contact-form-fields';

interface ContactCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
}

/**
 * Structured "Add contact" form — the direct, ≤2-click create path that sits
 * next to bulk "Import contacts" (#2639). Reuses the same field set and
 * validation as `ContactEditDialog` (`ContactFormFields` /
 * `useContactFormSchema`) so the two never disagree on which fields are
 * required.
 */
export function ContactCreateDialog({
  isOpen,
  onClose,
  organizationId,
}: ContactCreateDialogProps) {
  const { t: tContacts } = useT('contacts');
  const { mutateAsync: createContact } = useCreateContact();
  const formSchema = useContactFormSchema();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<ContactFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', email: '', phone: '', locale: 'en' },
  });

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const onSubmit = useCallback(
    async (data: ContactFormValues) => {
      try {
        await createContact({
          organizationId,
          name: data.name.trim() || undefined,
          email: data.email.trim(),
          phone: data.phone.trim() || undefined,
          locale: data.locale,
          // Same source a single manually-typed row gets via bulk import —
          // keeps the two create paths editable/filterable identically.
          source: 'manual_import',
        });

        toast({
          title: tContacts('create.success'),
          variant: 'success',
        });

        handleClose();
      } catch (error) {
        console.error('Create contact error:', error);
        const isDuplicate =
          backendErrorCode(error) === 'CONTACT_DUPLICATE_EMAIL';
        toast({
          title: isDuplicate
            ? tContacts('create.duplicateEmail')
            : tContacts('create.error'),
          variant: 'destructive',
        });
      }
    },
    [createContact, organizationId, tContacts, handleClose],
  );

  const handleOpenChange = (open: boolean) => {
    if (!open) handleClose();
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      title={tContacts('create.title')}
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
