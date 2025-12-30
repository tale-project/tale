'use client';

import { DeleteModal } from '@/components/ui/modals';
import { Stack } from '@/components/ui/layout';
import { useT } from '@/lib/i18n';

interface DeleteSyncFolderConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
  isLoading?: boolean;
  folderName?: string | null;
}

export default function DeleteSyncFolderConfirmationModal({
  open,
  onOpenChange,
  onConfirmDelete,
  isLoading = false,
  folderName,
}: DeleteSyncFolderConfirmationModalProps) {
  const { t: tDocuments } = useT('documents');

  return (
    <DeleteModal
      open={open}
      onOpenChange={onOpenChange}
      title={tDocuments('deleteSyncFolder.title')}
      description={<>{tDocuments('deleteSyncFolder.confirmation')} {folderName}?</>}
      deleteText={tDocuments('deleteSyncFolder.deleteButton')}
      isDeleting={isLoading}
      onDelete={onConfirmDelete}
    >
      <Stack gap={4}>
        <Stack gap={2}>
          <p className="text-sm text-muted-foreground">{tDocuments('deleteSyncFolder.thisWillDelete')}</p>
          <ul className="text-sm text-muted-foreground ml-4 space-y-1 list-disc">
            <li>{tDocuments('deleteSyncFolder.willDelete.filesAndSubfolders')}</li>
            <li>{tDocuments('deleteSyncFolder.willDelete.autoSyncConfig')}</li>
            <li>{tDocuments('deleteSyncFolder.willDelete.syncHistory')}</li>
          </ul>
        </Stack>
        <Stack gap={2}>
          <p className="text-sm text-muted-foreground">
            {tDocuments('deleteSyncFolder.willNotDelete.prefix')}{' '}
            <strong className="text-foreground">{tDocuments('deleteSyncFolder.willNotDelete.not')}</strong>{' '}
            {tDocuments('deleteSyncFolder.willNotDelete.suffix')}
          </p>
        </Stack>
      </Stack>
    </DeleteModal>
  );
}
