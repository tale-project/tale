'use client';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { useT } from '@/lib/i18n/client';

interface DocumentDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
  isLoading?: boolean;
  fileName?: string | null;
}

export function DocumentDeleteDialog({
  open,
  onOpenChange,
  onConfirmDelete,
  isLoading = false,
  fileName,
}: DocumentDeleteDialogProps) {
  const { t: tDocuments } = useT('documents');

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tDocuments('deleteFile.title')}
      description={
        <>
          {tDocuments('deleteFile.confirmationPrefix')}{' '}
          <strong>{fileName ?? tDocuments('deleteFile.thisDocument')}</strong>
          {tDocuments('deleteFile.confirmationSuffix')}
        </>
      }
      deleteText={tDocuments('deleteFile.deleteButton')}
      isDeleting={isLoading}
      onDelete={onConfirmDelete}
    />
  );
}
