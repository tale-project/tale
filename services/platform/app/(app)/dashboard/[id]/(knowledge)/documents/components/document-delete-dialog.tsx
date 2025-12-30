'use client';

import { DeleteModal } from '@/components/ui/modals';
import { useT } from '@/lib/i18n';

interface DeleteConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
  isLoading?: boolean;
  fileName?: string | null;
}

export default function DeleteConfirmationModal({
  open,
  onOpenChange,
  onConfirmDelete,
  isLoading = false,
  fileName,
}: DeleteConfirmationModalProps) {
  const { t: tDocuments } = useT('documents');

  return (
    <DeleteModal
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
