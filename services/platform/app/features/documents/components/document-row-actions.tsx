'use client';

import { CloudOff, RefreshCw, Trash2, Users } from 'lucide-react';
import { useMemo, useCallback, useRef } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { useAbility } from '@/app/hooks/use-ability';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import type { DocumentRecordInfo, RagStatus } from '@/types/documents';

import { useRetryRagIndexing } from '../hooks/actions';
import {
  useCancelOneDriveSync,
  useDeleteDocument,
  useDeleteFolder,
} from '../hooks/mutations';
import { useDocumentRecordActions } from '../hooks/use-document-record-actions';
import { DocumentDeleteDialog } from './document-delete-dialog';
import { DocumentDeleteFolderDialog } from './document-delete-folder-dialog';
import { DocumentTeamTagsDialog } from './document-team-tags-dialog';

type StorageSourceMode = 'auto' | 'manual';

interface DocumentRowActionsProps {
  documentId: string;
  itemType: 'file' | 'folder';
  name?: string | null;
  mimeType?: string;
  extension?: string;
  syncConfigId?: string;
  isDirectlySelected?: boolean;
  sourceMode?: StorageSourceMode;
  /** Gates "Mark as controlled" — only user/agent-authored documents can
   *  become controlled records (the server refuses sync-owned sources). */
  sourceProvider?: string;
  teamIds?: string[];
  onFolderDeleted?: () => void;
  parentFolderTeamId?: string;
  /** Gates the "Reindex" action — terminal `unsupported` files (no text
   *  extractor exists) never get a retry affordance, on the row menu any
   *  more than on the `RagStatusBadge` itself (#2598). */
  ragStatus?: RagStatus;
  /** Controlled-record state — drives the lifecycle actions + delete gate. */
  record?: DocumentRecordInfo;
}

export function DocumentRowActions({
  documentId,
  itemType,
  name,
  mimeType,
  extension,
  syncConfigId,
  isDirectlySelected,
  sourceMode,
  sourceProvider,
  teamIds,
  onFolderDeleted,
  parentFolderTeamId,
  ragStatus,
  record,
}: DocumentRowActionsProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');
  const { t: tGovernance } = useT('governance');
  const ability = useAbility();
  const canWrite = ability.can('write', 'knowledgeWrite');
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const dialogs = useEntityRowDialogs(['delete', 'deleteFolder', 'teamTags']);
  const { mutate: deleteDocument, isPending: isDeleting } = useDeleteDocument();
  const { mutate: deleteFolder, isPending: isDeletingFolder } =
    useDeleteFolder();
  const { mutateAsync: cancelSync, isPending: isCancellingSync } =
    useCancelOneDriveSync();
  const { mutateAsync: retryRagIndexing, isPending: isReindexing } =
    useRetryRagIndexing();
  // The record lifecycle entries + their dialogs, plus the legal-hold /
  // frozen-record signals the delete gate below surfaces.
  const {
    actions: recordActions,
    dialogs: recordDialogs,
    isHeld,
    isRecordProtected,
  } = useDocumentRecordActions({
    documentId,
    documentName: name,
    mimeType,
    extension,
    sourceProvider,
    record,
    canWrite,
    enabled: itemType === 'file',
    restoreFocusRef: menuTriggerRef,
  });

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

  const handleStopSync = useCallback(async () => {
    if (!syncConfigId || isCancellingSync) return;
    try {
      await cancelSync({
        configId: toId<'onedriveSyncConfigs'>(syncConfigId),
      });
      toast({
        title: tDocuments('actions.stopSyncDone'),
        variant: 'success',
      });
    } catch {
      toast({
        title: tDocuments('actions.stopSyncFailed'),
        variant: 'destructive',
      });
    }
  }, [cancelSync, syncConfigId, isCancellingSync, tDocuments]);

  const deleteLabel =
    itemType === 'folder' && syncConfigId
      ? tDocuments('actions.deleteSyncFolder')
      : tCommon('actions.delete');

  const actions = useMemo(
    () => [
      {
        key: 'reindex',
        label: tDocuments('actions.reindex'),
        icon: RefreshCw,
        onClick: handleReindex,
        visible: canWrite && itemType === 'file' && ragStatus !== 'unsupported',
        disabled: isReindexing,
      },
      ...recordActions,
      {
        key: 'teamTags',
        label: tDocuments('actions.manageTeams'),
        icon: Users,
        onClick: dialogs.open.teamTags,
        visible: canWrite && !parentFolderTeamId,
      },
      {
        key: 'stopSync',
        label: tDocuments('actions.stopSync'),
        icon: CloudOff,
        onClick: handleStopSync,
        // A synced folder, or a single file the user picked to sync directly.
        // A file synced as *part of* a folder carries that folder's config id,
        // so stopping it from the file row would cancel the whole folder —
        // those are stopped from the folder row instead.
        visible:
          canWrite &&
          !!syncConfigId &&
          (itemType === 'folder' || !!isDirectlySelected),
        disabled: isCancellingSync,
      },
      {
        key: 'delete',
        label: isHeld
          ? tGovernance('legalHold.badges.blockedByHold')
          : isRecordProtected
            ? tDocuments('record.blockedByRecord')
            : deleteLabel,
        icon: Trash2,
        onClick: handleDeleteClick,
        destructive: true,
        visible: canWrite && canDelete,
        disabled: isHeld || isRecordProtected,
      },
    ],
    [
      tDocuments,
      tGovernance,
      deleteLabel,
      handleDeleteClick,
      handleReindex,
      handleStopSync,
      canWrite,
      canDelete,
      itemType,
      dialogs.open,
      isReindexing,
      isCancellingSync,
      isRecordProtected,
      parentFolderTeamId,
      isHeld,
      recordActions,
      syncConfigId,
      isDirectlySelected,
      ragStatus,
    ],
  );

  return (
    <>
      <EntityRowActions actions={actions} triggerRef={menuTriggerRef} />

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

      {recordDialogs}
    </>
  );
}
