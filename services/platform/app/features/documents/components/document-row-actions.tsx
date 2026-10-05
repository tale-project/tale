'use client';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@tale/ui/entity/entity-row-actions';
import { toast } from '@tale/ui/use-toast';
import {
  CloudOff,
  Eye,
  FolderInput,
  Pencil,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import { useMemo, useCallback, useRef } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';
import {
  backendErrorCode,
  backendErrorMessage,
} from '@/lib/utils/backend-error';
import type { DocumentRecordInfo, RagStatus } from '@/types/documents';

import { useRetryRagIndexing } from '../hooks/actions';
import {
  useCancelGoogleDriveSync,
  useCancelOneDriveSync,
  useDeleteDocument,
  useDeleteFolder,
} from '../hooks/mutations';
import { useDocumentRecordActions } from '../hooks/use-document-record-actions';
import { DocumentDeleteDialog } from './document-delete-dialog';
import { DocumentDeleteFolderDialog } from './document-delete-folder-dialog';
import { DocumentMoveDialog } from './document-move-dialog';
import { DocumentTeamTagsDialog } from './document-team-tags-dialog';
import { RenameFolderDialog } from './rename-folder-dialog';

type StorageSourceMode = 'auto' | 'manual';

interface DocumentRowActionsProps {
  documentId: string;
  itemType: 'file' | 'folder';
  name?: string | null;
  mimeType?: string;
  extension?: string;
  syncConfigId?: string;
  /** A folder at, inside or above a synced folder: the sync decides its
   *  name, so the row offers no rename. */
  inSyncedTree?: boolean;
  isDirectlySelected?: boolean;
  sourceMode?: StorageSourceMode;
  /** Gates "Mark as controlled" — only user/agent-authored documents can
   *  become controlled records (the server refuses sync-owned sources). */
  sourceProvider?: string;
  teamIds?: string[];
  /** The folder the row sits in — the move dialog opens on it. */
  currentFolderId?: string;
  parentFolderTeamId?: string;
  /** Gates the "Reindex" action — terminal `unsupported` files (no text
   *  extractor exists) never get a retry affordance, on the row menu any
   *  more than on the `RagStatusBadge` itself (#2598). */
  ragStatus?: RagStatus;
  /** Controlled-record state — drives the lifecycle actions + delete gate. */
  record?: DocumentRecordInfo;
  /** Opens the file's preview — the row menu's View, like every knowledge row. */
  onView?: (documentId: string, opener: HTMLElement | null) => void;
}

export function DocumentRowActions({
  documentId,
  itemType,
  name,
  mimeType,
  extension,
  syncConfigId,
  inSyncedTree,
  isDirectlySelected,
  sourceMode,
  sourceProvider,
  teamIds,
  currentFolderId,
  parentFolderTeamId,
  ragStatus,
  record,
  onView,
}: DocumentRowActionsProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');
  const { t: tGovernance } = useT('governance');
  const ability = useAbility();
  const canWrite = ability.can('write', 'knowledgeWrite');
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const organizationId = useOrganizationId();
  const dialogs = useEntityRowDialogs([
    'delete',
    'deleteFolder',
    'rename',
    'teamTags',
    'move',
  ]);
  const { mutateAsync: deleteDocument, isPending: isDeleting } =
    useDeleteDocument();
  const { mutateAsync: deleteFolder, isPending: isDeletingFolder } =
    useDeleteFolder();
  const { mutateAsync: cancelOneDriveSync, isPending: isCancellingOneDrive } =
    useCancelOneDriveSync();
  const {
    mutateAsync: cancelGoogleDriveSync,
    isPending: isCancellingGoogleDrive,
  } = useCancelGoogleDriveSync();
  const isCancellingSync = isCancellingOneDrive || isCancellingGoogleDrive;
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
    void deleteDocument({ documentId: documentId }).then(
      () => dialogs.setOpen.delete(false),
      (error: unknown) => {
        console.error('Delete error:', error);
        toast({
          title: tDocuments('actions.deleteFileFailed'),
          variant: 'destructive',
        });
      },
    );
  }, [deleteDocument, documentId, dialogs.setOpen, tDocuments]);

  const handleDeleteFolderConfirm = useCallback(() => {
    void deleteFolder({ folderId: documentId }).then(
      () => dialogs.setOpen.deleteFolder(false),
      (error: unknown) => {
        console.error('Failed to delete folder:', error);
        // `AppError.message` is the serialized payload by design; the
        // readable sentence is `data.message`, and a retained record has
        // its own explanation.
        const message =
          backendErrorCode(error) === 'DOCUMENT_RECORD_PROTECTED'
            ? tDocuments('actions.deleteFolderProtectedRecord')
            : backendErrorMessage(error, '');
        toast({
          title: tDocuments('actions.deleteFolderFailed'),
          ...(message ? { description: message } : {}),
          variant: 'destructive',
        });
      },
    );
  }, [deleteFolder, documentId, dialogs.setOpen, tDocuments]);

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
        documentId: documentId,
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
    } catch (error) {
      console.error('Failed to retry indexing:', error);
      toast({
        title: tDocuments('rag.toast.unexpectedError'),
        description: failureDetail(error),
        variant: 'destructive',
      });
    }
  }, [documentId, retryRagIndexing, tDocuments, isReindexing]);

  const handleStopSync = useCallback(async () => {
    if (!syncConfigId || isCancellingSync) return;
    try {
      if (sourceProvider === 'google_drive') {
        await cancelGoogleDriveSync({
          configId: syncConfigId,
        });
      } else {
        await cancelOneDriveSync({
          configId: syncConfigId,
        });
      }
      toast({
        title: tDocuments('actions.stopSyncDone'),
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to stop the sync:', error);
      toast({
        title: tDocuments('actions.stopSyncFailed'),
        description: failureDetail(error),
        variant: 'destructive',
      });
    }
  }, [
    cancelGoogleDriveSync,
    cancelOneDriveSync,
    syncConfigId,
    sourceProvider,
    isCancellingSync,
    tDocuments,
  ]);

  const deleteLabel =
    itemType === 'folder' && syncConfigId
      ? tDocuments('actions.deleteSyncFolder')
      : tCommon('actions.delete');

  const actions = useMemo(
    () => [
      {
        key: 'view',
        label: tCommon('actions.view'),
        icon: Eye,
        onClick: () => onView?.(documentId, menuTriggerRef.current),
        visible: itemType === 'file' && onView !== undefined,
      },
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
        key: 'rename',
        label: tDocuments('actions.rename'),
        icon: Pencil,
        onClick: dialogs.open.rename,
        // A synced folder's name belongs to its source (OneDrive, Google
        // Drive) — the next sync would put the original back.
        visible:
          canWrite && itemType === 'folder' && !syncConfigId && !inSyncedTree,
      },
      {
        key: 'move',
        label: tDocuments('actions.moveToFolder'),
        icon: FolderInput,
        onClick: dialogs.open.move,
        // Files only: a folder move is its own operation (the whole subtree
        // travels with it) and has no door here yet.
        visible: canWrite && itemType === 'file',
      },
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
      tCommon,
      tGovernance,
      documentId,
      onView,
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
      inSyncedTree,
      isDirectlySelected,
      ragStatus,
    ],
  );

  return (
    <>
      <EntityRowActions actions={actions} triggerRef={menuTriggerRef} />

      {/* Each dialog mounts from its first open — every row of a folder
          carries them all — and stays mounted after it closes, so Radix
          plays its exit animation. */}
      {dialogs.mounted.delete && (
        <DocumentDeleteDialog
          open={dialogs.isOpen.delete}
          onOpenChange={dialogs.setOpen.delete}
          onConfirmDelete={handleDeleteConfirm}
          isLoading={isDeleting}
          fileName={name}
        />
      )}

      {dialogs.mounted.deleteFolder && (
        <DocumentDeleteFolderDialog
          open={dialogs.isOpen.deleteFolder}
          onOpenChange={dialogs.setOpen.deleteFolder}
          onConfirmDelete={handleDeleteFolderConfirm}
          isLoading={isDeletingFolder}
          folderName={name}
          isSyncFolder={!!syncConfigId}
        />
      )}

      {dialogs.isOpen.rename ? (
        <RenameFolderDialog
          open={dialogs.isOpen.rename}
          onOpenChange={dialogs.setOpen.rename}
          folderId={documentId}
          currentName={name ?? ''}
          restoreFocusRef={menuTriggerRef}
        />
      ) : null}

      {dialogs.isOpen.move && organizationId ? (
        <DocumentMoveDialog
          open={dialogs.isOpen.move}
          onOpenChange={dialogs.setOpen.move}
          organizationId={organizationId}
          documentId={documentId}
          documentName={name}
          currentFolderId={currentFolderId ?? null}
        />
      ) : null}

      {dialogs.mounted.teamTags && (
        <DocumentTeamTagsDialog
          open={dialogs.isOpen.teamTags}
          onOpenChange={dialogs.setOpen.teamTags}
          entityId={documentId}
          entityType={itemType}
          documentName={name}
          currentTeamIds={teamIds}
        />
      )}

      {recordDialogs}
    </>
  );
}
