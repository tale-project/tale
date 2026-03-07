'use client';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

interface DocumentDeleteFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
  isLoading?: boolean;
  folderName?: string | null;
  isSyncFolder?: boolean;
}

export function DocumentDeleteFolderDialog({
  open,
  onOpenChange,
  onConfirmDelete,
  isLoading = false,
  folderName,
  isSyncFolder = false,
}: DocumentDeleteFolderDialogProps) {
  const { t: tDocuments } = useT('documents');

  if (isSyncFolder) {
    return (
      <DeleteDialog
        open={open}
        onOpenChange={onOpenChange}
        title={tDocuments('deleteSyncFolder.title')}
        description={
          <>
            {tDocuments('deleteSyncFolder.confirmation')} {folderName}?
          </>
        }
        deleteText={tDocuments('deleteSyncFolder.deleteButton')}
        isDeleting={isLoading}
        onDelete={onConfirmDelete}
      >
        <Stack gap={4}>
          <Stack gap={2}>
            <Text variant="muted">
              {tDocuments('deleteSyncFolder.thisWillDelete')}
            </Text>
            <ul className="text-muted-foreground ml-4 list-disc space-y-1 text-sm">
              <li>
                {tDocuments('deleteSyncFolder.willDelete.filesAndSubfolders')}
              </li>
              <li>
                {tDocuments('deleteSyncFolder.willDelete.autoSyncConfig')}
              </li>
              <li>{tDocuments('deleteSyncFolder.willDelete.syncHistory')}</li>
            </ul>
          </Stack>
          <Stack gap={2}>
            <Text variant="muted">
              {tDocuments('deleteSyncFolder.willNotDelete.prefix')}{' '}
              <strong className="text-foreground">
                {tDocuments('deleteSyncFolder.willNotDelete.not')}
              </strong>{' '}
              {tDocuments('deleteSyncFolder.willNotDelete.suffix')}
            </Text>
          </Stack>
        </Stack>
      </DeleteDialog>
    );
  }

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tDocuments('deleteFolder.title')}
      description={
        <>
          {tDocuments('deleteFolder.confirmation')} {folderName}?
        </>
      }
      deleteText={tDocuments('deleteFolder.deleteButton')}
      isDeleting={isLoading}
      onDelete={onConfirmDelete}
    >
      <Text variant="muted">{tDocuments('deleteFolder.requirement')}</Text>
    </DeleteDialog>
  );
}
