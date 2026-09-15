'use client';

import { EntityDeleteDialog } from '@tale/ui/entity/entity-delete-dialog';
import { useDeleteDialogTranslations } from '@tale/ui/entity/use-delete-dialog';
import { type RefObject, useCallback } from 'react';

import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { useDeleteWebsite } from '../hooks/mutations';

interface WebsiteDeleteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  website: WebsiteDoc;
  /** Stable focus target when the opener (a row menu item) unmounts. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

export function WebsiteDeleteDialog({
  isOpen,
  onClose,
  website,
  restoreFocusRef,
}: WebsiteDeleteDialogProps) {
  const { t: tWebsites } = useT('websites');
  const { t: tToast } = useT('toast');
  const { mutateAsync: deleteWebsite } = useDeleteWebsite();

  const translations = useDeleteDialogTranslations({
    tEntity: tWebsites,
    tToast,
    keys: {
      title: 'delete.title',
      description: 'delete.confirmation',
      warningText: 'delete.warning',
      errorMessage: 'toast.deleteError',
    },
  });

  const handleDelete = useCallback(
    async (w: WebsiteDoc) => {
      await deleteWebsite({ websiteId: w._id });
    },
    [deleteWebsite],
  );

  const getEntityName = useCallback((w: WebsiteDoc) => w.domain, []);

  return (
    <EntityDeleteDialog
      isOpen={isOpen}
      onClose={onClose}
      entity={website}
      getEntityName={getEntityName}
      deleteMutation={handleDelete}
      translations={translations}
      restoreFocusRef={restoreFocusRef}
    />
  );
}
