'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { useForm } from '@tale/ui/use-form';
import { toast } from '@tale/ui/use-toast';
import { useCallback, useEffect, useRef, type RefObject } from 'react';

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
  /**
   * Seeds the Email field on every open — the address a caller already knows,
   * e.g. the one typed into a recipient picker that found no contact.
   */
  initialEmail?: string;
  /** The new contact's id, handed over before the dialog closes. */
  onCreated?: (contactId: string) => void;
  /**
   * Handles a duplicate email instead of the default toast. Resolve to the
   * existing contact's id to finish as a success (the caller owns the
   * message), or to `null` to fall through to the toast. Absent on the
   * Contacts page, which has nowhere to put a resolved id.
   */
  onDuplicateEmail?: (email: string) => Promise<string | null>;
  /**
   * Where focus returns on close. Needed when the opener does not survive the
   * open — a dropdown row unmounts with its popover, leaving nothing for the
   * default restore to find.
   */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

/** A blank create form, optionally carrying an address the caller supplied. */
function toFormValues(initialEmail?: string): ContactFormValues {
  return { name: '', email: initialEmail ?? '', phone: '', locale: 'en' };
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
  initialEmail,
  onCreated,
  onDuplicateEmail,
  restoreFocusRef,
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
    // Stays the BLANK shape even when `initialEmail` is set — see the reset
    // below for why the seeded address must not become the baseline.
    defaultValues: toFormValues(),
  });

  // Seed on the open transition only: `ContactsActionMenu` keeps this dialog
  // mounted at `isOpen={false}`, so a remount would never re-seed it, and
  // re-seeding on every render would wipe what the user typed.
  //
  // `keepDefaultValues` is load-bearing: `FormDialog` disables Save while
  // `!isDirty`, so making the seeded address the new baseline would open the
  // dialog with the email filled in and Save dead.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      reset(toFormValues(initialEmail), { keepDefaultValues: true });
    }
    wasOpen.current = isOpen;
  }, [isOpen, initialEmail, reset]);

  const handleClose = useCallback(() => {
    reset(toFormValues(initialEmail), { keepDefaultValues: true });
    onClose();
  }, [reset, initialEmail, onClose]);

  const onSubmit = useCallback(
    async (data: ContactFormValues) => {
      const email = data.email.trim();
      try {
        const contactId = await createContact({
          organizationId,
          name: data.name.trim() || undefined,
          email,
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

        onCreated?.(contactId);
        handleClose();
      } catch (error) {
        console.error('Create contact error:', error);
        const isDuplicate =
          backendErrorCode(error) === 'CONTACT_DUPLICATE_EMAIL';
        // A caller that can act on the twin (select it, say) gets first
        // refusal; it owns the message when it does, so no toast here.
        if (isDuplicate && onDuplicateEmail) {
          const existingId = await onDuplicateEmail(email);
          if (existingId !== null) {
            onCreated?.(existingId);
            handleClose();
            return;
          }
        }
        toast({
          title: isDuplicate
            ? tContacts('create.duplicateEmail')
            : tContacts('create.error'),
          variant: 'destructive',
        });
      }
    },
    [
      createContact,
      organizationId,
      tContacts,
      handleClose,
      onCreated,
      onDuplicateEmail,
    ],
  );

  const handleOpenChange = (open: boolean) => {
    if (!open) handleClose();
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      title={tContacts('create.title')}
      description={tContacts('create.description')}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      onSubmit={handleSubmit(onSubmit)}
      size="entity"
      restoreFocusRef={restoreFocusRef}
    >
      <ContactFormFields
        register={register}
        errors={errors}
        disabled={isSubmitting}
      />
    </FormDialog>
  );
}
