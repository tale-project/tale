'use client';

import { useTransition, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import type { Id } from '@/convex/_generated/dataModel';
import { useDeleteDocument } from '../hooks';
import DeleteConfirmationModal from './delete-confirmation-modal';
import DeleteSyncFolderConfirmationModal from './delete-folder-confirmation-modal';
import { Trash2 } from 'lucide-react';
import { useT } from '@/lib/i18n';

type StorageSourceMode = 'auto' | 'manual';

interface DocumentActionsProps {
  organizationId: string;
  documentId: string;
  storagePath: string;
  itemType: 'file' | 'folder';
  name?: string | null;
  syncConfigId?: string;
  isDirectlySelected?: boolean;
  sourceMode?: StorageSourceMode;
}

export default function DocumentActions({
  organizationId: _organizationId,
  documentId,
  storagePath: _storagePath,
  itemType,
  name,
  syncConfigId,
  isDirectlySelected,
  sourceMode,
}: DocumentActionsProps) {
  const { t: tDocuments } = useT('documents');
  const [isSyncPending, _startSyncTransition] = useTransition();
  const [isDeletePending, startDeleteTransition] = useTransition();
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleteFolderModalOpen, setIsDeleteFolderModalOpen] = useState(false);

  const deleteDocumentMutation = useDeleteDocument();

  const handleConfirmDeleteAutoSyncFolder = () => {
    setIsDeleteFolderModalOpen(false);
    startDeleteTransition(async () => {
      try {
        await deleteDocumentMutation({
          documentId: documentId as Id<'documents'>,
        });
      } catch (error) {
        console.error('Failed to delete folder:', error);
        toast({
          title: tDocuments('actions.deleteFolderFailed'),
          variant: 'destructive',
        });
      }
    });
  };

  const { toast } = useToast();

  const handleConfirmDelete = () => {
    setIsDeleteModalOpen(false);
    startDeleteTransition(async () => {
      try {
        await deleteDocumentMutation({
          documentId: documentId as Id<'documents'>,
        });
      } catch (error) {
        toast({
          title: tDocuments('actions.deleteFileFailed'),
          variant: 'destructive',
        });
        console.error('Delete error:', error);
      }
    });
  };

  const handleDeleteClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation(); // Prevent triggering parent onClick handlers
    if (itemType === 'folder') {
      setIsDeleteFolderModalOpen(true);
      return;
    }
    setIsDeleteModalOpen(true);
  };

  return (
    <div
      className="flex items-center gap-2 justify-end"
      onClick={(e) => e.stopPropagation()}
    >
      {(sourceMode === 'manual' ||
        isDirectlySelected ||
        (itemType === 'folder' && syncConfigId)) && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDeleteClick}
          disabled={isSyncPending || isDeletePending}
          aria-label={
            itemType === 'folder'
              ? tDocuments('actions.deleteSyncFolder')
              : tDocuments('actions.deleteDocument')
          }
        >
          {isDeletePending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
        </Button>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        onConfirmDelete={handleConfirmDelete}
        isLoading={isDeletePending}
        fileName={name}
      />

      <DeleteSyncFolderConfirmationModal
        open={isDeleteFolderModalOpen}
        onOpenChange={setIsDeleteFolderModalOpen}
        onConfirmDelete={handleConfirmDeleteAutoSyncFolder}
        isLoading={isDeletePending}
        folderName={name}
      />
    </div>
  );
}
