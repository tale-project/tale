'use client';

import { Button } from '@tale/ui/button';
import { Trash2 } from 'lucide-react';
import { useCallback } from 'react';

import { EntityDeleteDialog } from '@/app/components/ui/entity/entity-delete-dialog';
import {
  useDeleteDialog,
  useDeleteDialogTranslations,
} from '@/app/components/ui/entity/use-delete-dialog';
import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { useDeleteContact } from '../hooks/mutations';

interface ContactDeleteDialogProps {
  contact: ContactDoc;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  asChild?: boolean;
}

export function ContactDeleteDialog({
  contact,
  isOpen: controlledIsOpen,
  onOpenChange: controlledOnOpenChange,
  asChild = false,
}: ContactDeleteDialogProps) {
  const { t: tContacts } = useT('contacts');
  const { t: tToast } = useT('toast');
  const deleteContact = useDeleteContact();

  const dialog = useDeleteDialog({
    isOpen: controlledIsOpen,
    onOpenChange: controlledOnOpenChange,
  });

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
      await deleteContact.mutateAsync({ contactId: c._id });
    },
    [deleteContact],
  );

  const getEntityName = useCallback(
    (c: ContactDoc) => c.name || tContacts('thisContact'),
    [tContacts],
  );

  return (
    <>
      {!asChild && (
        <Button
          variant="ghost"
          size="icon"
          onClick={dialog.open}
          title={tContacts('deleteContact')}
        >
          <Trash2 className="text-muted-foreground size-4" />
        </Button>
      )}

      <EntityDeleteDialog
        isOpen={dialog.isOpen}
        onClose={dialog.close}
        entity={contact}
        getEntityName={getEntityName}
        deleteMutation={handleDelete}
        translations={translations}
      />
    </>
  );
}
