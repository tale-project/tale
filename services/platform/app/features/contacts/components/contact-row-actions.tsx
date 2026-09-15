'use client';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@tale/ui/entity/entity-row-actions';
import { useNavigate } from '@tanstack/react-router';
import { Eye, Mail, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useRef } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { canEmailContact, isEditableContact } from '../lib/contact-data';
import { ContactDeleteDialog } from './contact-delete-dialog';
import { ContactEditDialog } from './contact-edit-dialog';
import { ContactViewDialog } from './contact-view-dialog';

interface ContactRowActionsProps {
  contact: ContactDoc;
}

export function ContactRowActions({ contact }: ContactRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t: tConversations } = useT('conversations');
  const navigate = useNavigate();
  const ability = useAbility();
  // Dialogs opened from the menu return focus to its trigger: the menu item
  // that opened them is gone by the time they close.
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const dialogs = useEntityRowDialogs(['view', 'edit', 'delete']);

  const canEdit =
    ability.can('write', 'knowledgeWrite') && isEditableContact(contact);

  const actions = useMemo(
    () => [
      {
        key: 'view',
        label: tCommon('actions.view'),
        icon: Eye,
        onClick: dialogs.open.view,
      },
      {
        key: 'edit',
        label: tCommon('actions.edit'),
        icon: Pencil,
        onClick: dialogs.open.edit,
        visible: canEdit,
      },
      {
        key: 'email',
        label: tConversations('compose.newEmail'),
        icon: Mail,
        // Opens the inbox's compose pane, seeded with this contact — the same
        // surface as the header "Compose", so there's one compose experience.
        // Emailing is independent of edit rights: a synced, non-editable
        // contact is still a valid recipient, as long as it has a real address.
        onClick: () =>
          void navigate({
            to: '/dashboard/$id/conversations/$status',
            params: { id: contact.organizationId, status: 'open' },
            search: { compose: 'new', composeContact: contact._id },
          }),
        visible: canEmailContact(contact),
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
    [tCommon, tConversations, dialogs.open, canEdit, navigate, contact],
  );

  return (
    <>
      <EntityRowActions actions={actions} triggerRef={menuTriggerRef} />

      {dialogs.isOpen.view && (
        <ContactViewDialog
          isOpen
          onClose={() => dialogs.setOpen.view(false)}
          restoreFocusRef={menuTriggerRef}
          contact={contact}
        />
      )}

      {dialogs.isOpen.edit && (
        <ContactEditDialog
          isOpen
          onClose={() => dialogs.setOpen.edit(false)}
          restoreFocusRef={menuTriggerRef}
          contact={contact}
        />
      )}

      {dialogs.isOpen.delete && (
        <ContactDeleteDialog
          isOpen
          onClose={() => dialogs.setOpen.delete(false)}
          restoreFocusRef={menuTriggerRef}
          contact={contact}
        />
      )}
    </>
  );
}
