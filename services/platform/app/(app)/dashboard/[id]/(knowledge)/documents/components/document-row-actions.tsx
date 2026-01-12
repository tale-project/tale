'use client';

import { useMemo, useCallback, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/components/ui/entity/entity-row-actions';
import type { Id } from '@/convex/_generated/dataModel';
import { useDeleteDocument } from '../hooks/use-delete-document';
import { DocumentDeleteDialog } from './document-delete-dialog';
import { DocumentDeleteFolderDialog } from './document-delete-folder-dialog';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

type StorageSourceMode = 'auto' | 'manual';

interface DocumentRowActionsProps {
  documentId: string;
  itemType: 'file' | 'folder';
  name?: string | null;
  syncConfigId?: string;
  isDirectlySelected?: boolean;
  sourceMode?: StorageSourceMode;
}

export function DocumentRowActions({
  documentId,
  itemType,
  name,
  syncConfigId,
  isDirectlySelected,
  sourceMode,
}: DocumentRowActionsProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');
  const dialogs = useEntityRowDialogs(['delete', 'deleteFolder']);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteDocument = useDeleteDocument();

  // Determine if delete action should be visible
  const canDelete =
    sourceMode === 'manual' ||
    !!isDirectlySelected ||
    (itemType === 'folder' && !!syncConfigId);

  const handleDeleteConfirm = useCallback(async () => {
    try {
      setIsDeleting(true);
      await deleteDocument({
        documentId: documentId as Id<'documents'>,
      });
      dialogs.setOpen.delete(false);
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        title: tDocuments('actions.deleteFileFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteDocument, documentId, dialogs.setOpen, tDocuments]);

  const handleDeleteFolderConfirm = useCallback(async () => {
    try {
      setIsDeleting(true);
      await deleteDocument({
        documentId: documentId as Id<'documents'>,
      });
      dialogs.setOpen.deleteFolder(false);
    } catch (error) {
      console.error('Failed to delete folder:', error);
      toast({
        title: tDocuments('actions.deleteFolderFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteDocument, documentId, dialogs.setOpen, tDocuments]);

  const handleDeleteClick = useCallback(() => {
    if (itemType === 'folder') {
      dialogs.open.deleteFolder();
    } else {
      dialogs.open.delete();
    }
  }, [itemType, dialogs.open]);

  const actions = useMemo(
    () => [
      {
        key: 'delete',
        label:
          itemType === 'folder'
            ? tDocuments('actions.deleteSyncFolder')
            : tCommon('actions.delete'),
        icon: Trash2,
        onClick: handleDeleteClick,
        destructive: true,
        visible: canDelete,
      },
    ],
    [tDocuments, tCommon, handleDeleteClick, canDelete, itemType]
  );

  // Don't render anything if delete is not allowed
  if (!canDelete) {
    return null;
  }

  return (
    <>
      <EntityRowActions actions={actions} />

      <DocumentDeleteDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        onConfirmDelete={handleDeleteConfirm}
        isLoading={isDeleting}
        fileName={name}
      />

      <DocumentDeleteFolderDialog
        open={dialogs.isOpen.deleteFolder}
        onOpenChange={dialogs.setOpen.deleteFolder}
        onConfirmDelete={handleDeleteFolderConfirm}
        isLoading={isDeleting}
        folderName={name}
      />
    </>
  );
}
