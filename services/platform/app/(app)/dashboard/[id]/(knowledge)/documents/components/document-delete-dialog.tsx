'use client';

import { DeleteDialog } from '@/components/ui/dialog';
import { useT } from '@/lib/i18n';

interface DocumentDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
  isLoading?: boolean;
  fileName?: string | null;
}

export default function DocumentDeleteDialog({
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
      description={tDocuments('deleteFile.confirmation', { name: fileName ?? tDocuments('deleteFile.thisFile') })}
      deleteText={tDocuments('deleteFile.deleteButton')}
      isDeleting={isLoading}
      onDelete={onConfirmDelete}
      warning={tDocuments('deleteFile.warning')}
    />
  );
}
