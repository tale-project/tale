'use client';

import { EntityDeleteDialog } from '@tale/ui/entity/entity-delete-dialog';
import { useDeleteDialogTranslations } from '@tale/ui/entity/use-delete-dialog';
import { type RefObject, useCallback } from 'react';

import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { useDeleteContact } from '../hooks/mutations';

interface ContactDeleteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  contact: ContactDoc;
  /** Stable focus target when the opener (a row menu item) unmounts. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

export function ContactDeleteDialog({
  isOpen,
  onClose,
  contact,
  restoreFocusRef,
}: ContactDeleteDialogProps) {
  const { t: tContacts } = useT('contacts');
  const { t: tToast } = useT('toast');
  const { mutateAsync: deleteContact } = useDeleteContact();

  const translations = useDeleteDialogTranslations({
    tEntity: tContacts,
    tToast,
    keys: {
      title: 'deleteContact',
      description: 'deleteConfirmation',
      warningText: 'deleteWarning',
      errorMessage: 'deleteError',
    },
  });

  const handleDelete = useCallback(
    async (c: ContactDoc) => {
      await deleteContact({ contactId: c._id });
    },
    [deleteContact],
  );

  const getEntityName = useCallback(
    (c: ContactDoc) => c.name || c.email || tContacts('thisContact'),
    [tContacts],
  );

  return (
    <EntityDeleteDialog
      isOpen={isOpen}
      onClose={onClose}
      entity={contact}
      getEntityName={getEntityName}
      deleteMutation={handleDelete}
      translations={translations}
      restoreFocusRef={restoreFocusRef}
    />
  );
}
