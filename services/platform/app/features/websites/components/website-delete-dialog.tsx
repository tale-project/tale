'use client';

import { useCallback } from 'react';

import { EntityDeleteDialog } from '@/app/components/ui/entity/entity-delete-dialog';
import { useDeleteDialogTranslations } from '@/app/components/ui/entity/use-delete-dialog';
import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { useDeleteWebsite } from '../hooks/mutations';

interface DeleteWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  website: WebsiteDoc;
}

export function DeleteWebsiteDialog({
  isOpen,
  onClose,
  website,
}: DeleteWebsiteDialogProps) {
  const { t: tWebsites } = useT('websites');
  const { t: tToast } = useT('toast');
  const { mutateAsync: deleteWebsite } = useDeleteWebsite();

  const translations = useDeleteDialogTranslations({
    tEntity: tWebsites,
    tToast,
    keys: {
      title: 'delete.title',
      description: 'delete.confirmation',
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
    />
  );
}
