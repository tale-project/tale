'use client';

import { useCallback } from 'react';

import { EntityDeleteDialog } from '@/app/components/ui/entity/entity-delete-dialog';
import { useDeleteDialogTranslations } from '@/app/components/ui/entity/use-delete-dialog';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useWebsiteCollection } from '../hooks/collections';
import { useDeleteWebsite } from '../hooks/mutations';

interface DeleteWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  website: Doc<'websites'>;
}

export function DeleteWebsiteDialog({
  isOpen,
  onClose,
  website,
}: DeleteWebsiteDialogProps) {
  const { t: tWebsites } = useT('websites');
  const { t: tToast } = useT('toast');
  const websiteCollection = useWebsiteCollection(website.organizationId);
  const deleteWebsite = useDeleteWebsite(websiteCollection);

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
    async (w: Doc<'websites'>) => {
      await deleteWebsite({ websiteId: w._id });
    },
    [deleteWebsite],
  );

  const getEntityName = useCallback((w: Doc<'websites'>) => w.domain, []);

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
