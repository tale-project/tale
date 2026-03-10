'use client';

import { Fragment, useMemo } from 'react';

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

  const displayName = fileName ?? tDocuments('deleteFile.thisDocument');

  const description = useMemo(() => {
    const raw = tDocuments('deleteFile.confirmation', { name: '{name}' });
    const parts = raw.split('{name}');
    if (parts.length <= 1) return raw;
    return (
      <>
        {parts.map((part, index) => (
          <Fragment key={index}>
            {part}
            {index < parts.length - 1 && <strong>{displayName}</strong>}
          </Fragment>
        ))}
      </>
    );
  }, [tDocuments, displayName]);

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tDocuments('deleteFile.title')}
      description={description}
      deleteText={tDocuments('deleteFile.deleteButton')}
      isDeleting={isLoading}
      onDelete={onConfirmDelete}
    />
  );
}
