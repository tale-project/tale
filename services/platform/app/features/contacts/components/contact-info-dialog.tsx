'use client';

import { IconButton } from '@tale/ui/icon-button';
import { HStack } from '@tale/ui/layout';
import { useNavigate } from '@tanstack/react-router';
import { Mail, Pencil } from 'lucide-react';
import { useCallback, useState } from 'react';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { useAbility } from '@/app/hooks/use-ability';
import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import type { ContactInfo } from '@/convex/conversations/types';
import { useT } from '@/lib/i18n/client';

import { isContactDoc, UNKNOWN_CONTACT_EMAIL } from '../lib/contact-data';
import { ContactEditDialog } from './contact-edit-dialog';
import { ContactInformation } from './contact-information';

interface ContactInfoDialogProps {
  contact: ContactDoc | ContactInfo;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * Read-only contact details (row click). Offers the same Edit / New email
 * shortcuts as the row's ⋮ menu (#2639) so a user doesn't have to close the
 * dialog to act on what they're looking at — gated the same way
 * `ContactRowActions` gates them (editable source, ability, real email).
 * Only available for a full `ContactDoc` row: the lightweight
 * `ContactInfo` embedded in a conversation has no `_id`/`source` to act on.
 */
export function ContactInfoDialog({
  contact,
  open,
  onOpenChange,
  className,
}: ContactInfoDialogProps) {
  const { t } = useT('dialogs');
  const { t: tCommon } = useT('common');
  const { t: tConversations } = useT('conversations');
  const navigate = useNavigate();
  const ability = useAbility();
  const [isEditOpen, setIsEditOpen] = useState(false);

  const handleClose = useCallback(
    (isOpen: boolean) => onOpenChange?.(isOpen),
    [onOpenChange],
  );

  const fullContact = isContactDoc(contact) ? contact : null;
  const canEdit =
    !!fullContact &&
    ability.can('write', 'knowledgeWrite') &&
    (fullContact.source === 'manual_import' ||
      fullContact.source === 'file_upload');
  const canEmail = Boolean(
    contact.email && contact.email !== UNKNOWN_CONTACT_EMAIL,
  );

  const handleEditClick = useCallback(() => {
    handleClose(false);
    setIsEditOpen(true);
  }, [handleClose]);

  const handleEmailClick = useCallback(() => {
    if (!fullContact) return;
    handleClose(false);
    void navigate({
      to: '/dashboard/$id/conversations/$status',
      params: { id: fullContact.organizationId, status: 'open' },
      search: { compose: 'new', composeContact: fullContact._id },
    });
  }, [fullContact, handleClose, navigate]);

  const headerActions =
    canEmail || canEdit ? (
      <HStack gap={1}>
        {canEmail && (
          <IconButton
            icon={Mail}
            aria-label={tConversations('compose.newEmail')}
            onClick={handleEmailClick}
          />
        )}
        {canEdit && (
          <IconButton
            icon={Pencil}
            aria-label={tCommon('actions.edit')}
            onClick={handleEditClick}
          />
        )}
      </HStack>
    ) : undefined;

  return (
    <>
      <ViewDialog
        open={open ?? true}
        onOpenChange={handleClose}
        title={t('contactInfo.title')}
        headerActions={headerActions}
        className={className}
      >
        <div className="max-h-[calc(100vh-12rem)] space-y-8 overflow-y-auto">
          <ContactInformation contact={contact} />
        </div>
      </ViewDialog>

      {fullContact && (
        <ContactEditDialog
          contact={fullContact}
          isOpen={isEditOpen}
          onOpenChange={setIsEditOpen}
        />
      )}
    </>
  );
}
