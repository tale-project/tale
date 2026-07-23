'use client';

import { useCallback } from 'react';

import { EntityDeleteDialog } from '@/app/components/ui/entity/entity-delete-dialog';
import { useDeleteDialogTranslations } from '@/app/components/ui/entity/use-delete-dialog';
import { useT } from '@/lib/i18n/client';

import { useDeleteKnowledgeEntry } from '../hooks/mutations';
import type { KnowledgeEntryItem } from '../hooks/queries';

interface DeleteKnowledgeEntryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  entry: KnowledgeEntryItem;
}

export function DeleteKnowledgeEntryDialog({
  isOpen,
  onClose,
  entry,
}: DeleteKnowledgeEntryDialogProps) {
  const { t } = useT('knowledgeEntries');
  const { t: tToast } = useT('toast');
  const { mutateAsync: deleteEntry } = useDeleteKnowledgeEntry();

  const translations = useDeleteDialogTranslations({
    tEntity: t,
    tToast,
    keys: {
      title: 'delete.title',
      description: 'delete.confirmation',
      errorMessage: 'toast.deleteError',
    },
  });

  const handleDelete = useCallback(
    async (e: KnowledgeEntryItem) => {
      await deleteEntry({ entryId: e._id });
    },
    [deleteEntry],
  );

  const getEntityName = useCallback((e: KnowledgeEntryItem) => e.topic, []);

  return (
    <EntityDeleteDialog
      isOpen={isOpen}
      onClose={onClose}
      entity={entry}
      getEntityName={getEntityName}
      deleteMutation={handleDelete}
      translations={translations}
    />
  );
}
