'use client';

import { Button } from '@tale/ui/button';
import { ViewDialog } from '@tale/ui/dialog/view-dialog';
import { IconButton } from '@tale/ui/icon-button';
import { useNavigate } from '@tanstack/react-router';
import { Mail, Pencil } from 'lucide-react';
import { useCallback, useState } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import type { ContactInfo } from '@/backend/core/conversations/types';
import { useT } from '@/lib/i18n/client';

import { isContactDoc, UNKNOWN_CONTACT_EMAIL } from '../lib/contact-data';
import { CONTACT_EDIT_FORM_ID, useContactEditForm } from './contact-edit-form';
import { ContactFormFields } from './contact-form-fields';
import { ContactInformation } from './contact-information';

interface ContactInfoDialogProps {
  contact: ContactDoc | ContactInfo;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * Read-only contact card (row click). The person's name is the view title
 * — same pattern as a product view — so the type label "Contact details"
 * is not repeated. Edit / New email sit on the title row with the name;
 * Close stays on the far right as chrome (#2639), gated the same way
 * `ContactRowActions` gates them. Edit morphs in place to the form title
 * ("Edit contact") without a second overlay.
 * Only a full `ContactDoc` row can act: the lightweight `ContactInfo`
 * embedded in a conversation has no `_id`/`source`.
 */
export function ContactInfoDialog({
  contact,
  open,
  onOpenChange,
  className,
}: ContactInfoDialogProps) {
  const fullContact = isContactDoc(contact) ? contact : null;
  if (fullContact) {
    return (
      <ContactDocInfoDialog
        contact={fullContact}
        open={open}
        onOpenChange={onOpenChange}
        className={className}
      />
    );
  }
  return (
    <ContactReadDialog
      contact={contact}
      open={open}
      onOpenChange={onOpenChange}
      className={className}
    />
  );
}

function ContactReadDialog({
  contact,
  open,
  onOpenChange,
  className,
}: {
  contact: ContactDoc | ContactInfo;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const { t: tCommon } = useT('common');
  const name = contact.name?.trim();
  const title = name || contact.email || tCommon('labels.notAvailable');
  const description = name && contact.email ? contact.email : undefined;

  return (
    <ViewDialog
      open={open ?? true}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      className={className}
    >
      <ContactInformation contact={contact} />
    </ViewDialog>
  );
}

function ContactDocInfoDialog({
  contact,
  open,
  onOpenChange,
  className,
}: {
  contact: ContactDoc;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const { t: tCommon } = useT('common');
  const { t: tContacts } = useT('contacts');
  const { t: tConversations } = useT('conversations');
  const navigate = useNavigate();
  const ability = useAbility();
  const [isEditing, setIsEditing] = useState(false);
  const { register, errors, isSubmitting, seed, submit } = useContactEditForm(
    contact,
    () => setIsEditing(false),
  );

  const handleClose = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        seed();
        setIsEditing(false);
      }
      onOpenChange?.(isOpen);
    },
    [onOpenChange, seed],
  );

  const canEdit =
    ability.can('write', 'knowledgeWrite') &&
    (contact.source === 'manual_import' || contact.source === 'file_upload');
  const canEmail = Boolean(
    contact.email && contact.email !== UNKNOWN_CONTACT_EMAIL,
  );

  const startEdit = useCallback(() => {
    seed();
    setIsEditing(true);
  }, [seed]);

  const cancelEdit = useCallback(() => {
    seed();
    setIsEditing(false);
  }, [seed]);

  const handleEmailClick = useCallback(() => {
    handleClose(false);
    void navigate({
      to: '/dashboard/$id/conversations/$status',
      params: { id: contact.organizationId, status: 'open' },
      search: { compose: 'new', composeContact: contact._id },
    });
  }, [contact, handleClose, navigate]);

  const name = contact.name?.trim();
  const title = name || contact.email || tCommon('labels.notAvailable');
  const description = name && contact.email ? contact.email : undefined;

  const headerActions =
    canEmail || (canEdit && !isEditing) ? (
      <>
        {canEmail && (
          <IconButton
            icon={Mail}
            size="sm"
            aria-label={tConversations('compose.newEmail')}
            onClick={handleEmailClick}
          />
        )}
        {canEdit && !isEditing && (
          <IconButton
            icon={Pencil}
            size="sm"
            aria-label={tCommon('actions.edit')}
            onClick={startEdit}
          />
        )}
      </>
    ) : undefined;

  return (
    <ViewDialog
      open={open ?? true}
      onOpenChange={handleClose}
      title={isEditing ? tContacts('editContact') : title}
      description={isEditing ? undefined : description}
      headerActions={isEditing ? undefined : headerActions}
      headerActionsPlacement="inline"
      className={className}
      customFooter={
        isEditing ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={cancelEdit}
              disabled={isSubmitting}
            >
              {tCommon('actions.cancel')}
            </Button>
            <Button
              type="submit"
              form={CONTACT_EDIT_FORM_ID}
              disabled={isSubmitting}
              isLoading={isSubmitting}
            >
              {tCommon('actions.save')}
            </Button>
          </>
        ) : undefined
      }
    >
      {isEditing ? (
        <form
          id={CONTACT_EDIT_FORM_ID}
          onSubmit={submit}
          className="space-y-4"
          noValidate
        >
          <ContactFormFields
            register={register}
            errors={errors}
            disabled={isSubmitting}
            autoFocus
          />
        </form>
      ) : (
        <ContactInformation contact={contact} />
      )}
    </ViewDialog>
  );
}
