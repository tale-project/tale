'use client';

import { EntityDeleteDialog } from '@tale/ui/entity/entity-delete-dialog';
import { useDeleteDialogTranslations } from '@tale/ui/entity/use-delete-dialog';
import { type RefObject, useCallback } from 'react';

import { useT } from '@/lib/i18n/client';

import { useDeleteKnowledgeEntry } from '../hooks/mutations';
import type { KnowledgeEntryItem } from '../hooks/queries';

interface KnowledgeEntryDeleteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  entry: KnowledgeEntryItem;
  /** Stable focus target when the opener (a row menu item) unmounts. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

export function KnowledgeEntryDeleteDialog({
  isOpen,
  onClose,
  entry,
  restoreFocusRef,
}: KnowledgeEntryDeleteDialogProps) {
  const { t } = useT('knowledgeEntries');
  const { t: tToast } = useT('toast');
  const { mutateAsync: deleteEntry } = useDeleteKnowledgeEntry();

  const translations = useDeleteDialogTranslations({
    tEntity: t,
    tToast,
    keys: {
      title: 'delete.title',
      description: 'delete.confirmation',
      warningText: 'delete.warning',
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
      restoreFocusRef={restoreFocusRef}
    />
  );
}
