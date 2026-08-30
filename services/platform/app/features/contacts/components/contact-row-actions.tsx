'use client';

import { useNavigate } from '@tanstack/react-router';
import { Mail, Pencil, Trash2 } from 'lucide-react';
import { useMemo } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { useAbility } from '@/app/hooks/use-ability';
import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { UNKNOWN_CONTACT_EMAIL } from '../lib/contact-data';
import { ContactDeleteDialog } from './contact-delete-dialog';
import { ContactEditDialog } from './contact-edit-dialog';

interface ContactRowActionsProps {
  contact: ContactDoc;
}

export function ContactRowActions({ contact }: ContactRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t: tConversations } = useT('conversations');
  const navigate = useNavigate();
  const ability = useAbility();
  const canWrite = ability.can('write', 'knowledgeWrite');
  const dialogs = useEntityRowDialogs(['edit', 'delete']);

  const canEdit =
    canWrite &&
    (contact.source === 'manual_import' || contact.source === 'file_upload');

  // Emailing a contact is independent of edit rights — a synced, non-editable
  // contact is still a valid recipient, as long as it has a real address.
  const canEmail = Boolean(
    contact.email && contact.email !== UNKNOWN_CONTACT_EMAIL,
  );

  const actions = useMemo(
    () => [
      {
        key: 'email',
        label: tConversations('compose.newEmail'),
        icon: Mail,
        // Opens the inbox's compose pane, seeded with this contact — the same
        // surface as the header "Compose", so there's one compose experience.
        onClick: () =>
          void navigate({
            to: '/dashboard/$id/conversations/$status',
            params: { id: contact.organizationId, status: 'open' },
            search: { compose: 'new', composeContact: contact._id },
          }),
        visible: canEmail,
      },
      {
        key: 'edit',
        label: tCommon('actions.edit'),
        icon: Pencil,
        onClick: dialogs.open.edit,
        visible: canEdit,
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        onClick: dialogs.open.delete,
        destructive: true,
        visible: canEdit,
      },
    ],
    [
      tCommon,
      tConversations,
      dialogs.open,
      canEdit,
      canEmail,
      navigate,
      contact,
    ],
  );

  if (!canEdit && !canEmail) return null;

  return (
    <>
      <EntityRowActions actions={actions} />

      {canEdit && (
        <>
          <ContactEditDialog
            contact={contact}
            isOpen={dialogs.isOpen.edit}
            onOpenChange={dialogs.setOpen.edit}
            asChild
          />

          <ContactDeleteDialog
            contact={contact}
            isOpen={dialogs.isOpen.delete}
            onOpenChange={dialogs.setOpen.delete}
            asChild
          />
        </>
      )}
    </>
  );
}
