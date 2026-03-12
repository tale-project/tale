'use client';

import { RefreshCw, Trash2, Users } from 'lucide-react';
import { useMemo, useCallback } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import { useRetryRagIndexing } from '../hooks/actions';
import { useDeleteDocument, useDeleteFolder } from '../hooks/mutations';
import { DocumentDeleteDialog } from './document-delete-dialog';
import { DocumentDeleteFolderDialog } from './document-delete-folder-dialog';
import { DocumentTeamTagsDialog } from './document-team-tags-dialog';

type StorageSourceMode = 'auto' | 'manual';

interface DocumentRowActionsProps {
  documentId: string;
  itemType: 'file' | 'folder';
  name?: string | null;
  syncConfigId?: string;
  isDirectlySelected?: boolean;
  sourceMode?: StorageSourceMode;
  teamIds?: string[];
  onFolderDeleted?: () => void;
  parentFolderTeamId?: string;
}

export function DocumentRowActions({
  documentId,
  itemType,
  name,
  syncConfigId,
  isDirectlySelected,
  sourceMode,
  teamIds,
  onFolderDeleted,
  parentFolderTeamId,
}: DocumentRowActionsProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');
  const dialogs = useEntityRowDialogs(['delete', 'deleteFolder', 'teamTags']);
  const { mutate: deleteDocument, isPending: isDeleting } = useDeleteDocument();
  const { mutate: deleteFolder, isPending: isDeletingFolder } =
    useDeleteFolder();
  const { mutateAsync: retryRagIndexing, isPending: isReindexing } =
    useRetryRagIndexing();

  // Determine if delete action should be visible
  const canDelete =
    sourceMode === 'manual' || !!isDirectlySelected || itemType === 'folder';

  const handleDeleteConfirm = useCallback(() => {
    deleteDocument(
      { documentId: toId<'documents'>(documentId) },
      {
        onSuccess: () => dialogs.setOpen.delete(false),
        onError: (error) => {
          console.error('Delete error:', error);
          toast({
            title: tDocuments('actions.deleteFileFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [deleteDocument, documentId, dialogs.setOpen, tDocuments]);

  const handleDeleteFolderConfirm = useCallback(() => {
    deleteFolder(
      { folderId: toId<'folders'>(documentId) },
      {
        onSuccess: () => {
          dialogs.setOpen.deleteFolder(false);
          onFolderDeleted?.();
        },
        onError: (error) => {
          console.error('Failed to delete folder:', error);
          toast({
            title: tDocuments('actions.deleteFolderFailed'),
            description: error instanceof Error ? error.message : undefined,
            variant: 'destructive',
          });
        },
      },
    );
  }, [deleteFolder, documentId, dialogs.setOpen, tDocuments, onFolderDeleted]);

  const handleDeleteClick = useCallback(() => {
    if (itemType === 'folder') {
      dialogs.open.deleteFolder();
    } else {
      dialogs.open.delete();
    }
  }, [itemType, dialogs.open]);

  const handleReindex = useCallback(async () => {
    if (isReindexing) return;
    try {
      const result = await retryRagIndexing({
        documentId: toId<'documents'>(documentId),
      });
      if (result.success) {
        toast({
          title: tDocuments('rag.toast.indexingStarted'),
          description: tDocuments('rag.toast.indexingQueued'),
        });
      } else {
        toast({
          title: tDocuments('rag.toast.retryFailed'),
          description:
            result.error || tDocuments('rag.toast.retryFailedDescription'),
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: tDocuments('rag.toast.unexpectedError'),
        variant: 'destructive',
      });
    }
  }, [documentId, retryRagIndexing, tDocuments, isReindexing]);

  const actions = useMemo(
    () => [
      {
        key: 'reindex',
        label: tDocuments('actions.reindex'),
        icon: RefreshCw,
        onClick: handleReindex,
        visible: itemType === 'file',
        disabled: isReindexing,
      },
      {
        key: 'teamTags',
        label: tDocuments('actions.manageTeams'),
        icon: Users,
        onClick: dialogs.open.teamTags,
        visible: !parentFolderTeamId,
      },
      {
        key: 'delete',
        label:
          itemType === 'folder' && syncConfigId
            ? tDocuments('actions.deleteSyncFolder')
            : tCommon('actions.delete'),
        icon: Trash2,
        onClick: handleDeleteClick,
        destructive: true,
        visible: canDelete,
      },
    ],
    [
      tDocuments,
      tCommon,
      handleDeleteClick,
      handleReindex,
      canDelete,
      itemType,
      syncConfigId,
      dialogs.open,
      isReindexing,
      parentFolderTeamId,
    ],
  );

  return (
    <>
      <EntityRowActions actions={actions} />

      {/* Always mount dialogs to allow Radix UI to handle animation states properly */}
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
        isLoading={isDeletingFolder}
        folderName={name}
        isSyncFolder={!!syncConfigId}
      />

      <DocumentTeamTagsDialog
        open={dialogs.isOpen.teamTags}
        onOpenChange={dialogs.setOpen.teamTags}
        entityId={documentId}
        entityType={itemType}
        documentName={name}
        currentTeamIds={teamIds}
      />
    </>
  );
}
