'use client';

import { RefreshCw, Trash2, Users } from 'lucide-react';
import { useMemo, useCallback, useState, useRef } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useDeleteDocument } from '../hooks/use-delete-document';
import { useRetryRagIndexing } from '../hooks/use-retry-rag-indexing';
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
  teamTags?: string[];
}

export function DocumentRowActions({
  documentId,
  itemType,
  name,
  syncConfigId,
  isDirectlySelected,
  sourceMode,
  teamTags,
}: DocumentRowActionsProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');
  const dialogs = useEntityRowDialogs(['delete', 'deleteFolder', 'teamTags']);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const reindexingRef = useRef(false);
  const deleteDocument = useDeleteDocument();
  const retryRagIndexing = useRetryRagIndexing();

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

  const handleReindex = useCallback(async () => {
    if (reindexingRef.current) return;
    reindexingRef.current = true;
    setIsReindexing(true);
    try {
      const result = await retryRagIndexing({
        documentId: documentId as Id<'documents'>,
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
    } finally {
      reindexingRef.current = false;
      setIsReindexing(false);
    }
  }, [documentId, retryRagIndexing, tDocuments]);

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
        visible: itemType === 'file',
      },
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
    [
      tDocuments,
      tCommon,
      handleDeleteClick,
      handleReindex,
      canDelete,
      itemType,
      dialogs.open,
      isReindexing,
    ],
  );

  // Show actions if user can delete OR if it's a file (for team tags)
  const hasVisibleActions = canDelete || itemType === 'file';
  if (!hasVisibleActions) {
    return null;
  }

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
        isLoading={isDeleting}
        folderName={name}
      />

      <DocumentTeamTagsDialog
        open={dialogs.isOpen.teamTags}
        onOpenChange={dialogs.setOpen.teamTags}
        documentId={documentId}
        documentName={name}
        currentTeamTags={teamTags}
      />
    </>
  );
}
