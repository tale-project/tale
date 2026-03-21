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

  const truncatedName = useMemo(() => {
    const maxLength = 38;
    if (displayName.length <= maxLength) return displayName;
    const keep = Math.floor((maxLength - 1) / 2);
    return `${displayName.slice(0, keep)}…${displayName.slice(-keep)}`;
  }, [displayName]);

  const description = useMemo(() => {
    const raw = tDocuments('deleteFile.confirmation', { name: '{name}' });
    const parts = raw.split('{name}');
    if (parts.length <= 1) return raw;
    return (
      <>
        {parts.map((part, index) => (
          <Fragment key={index}>
            {part}
            {index < parts.length - 1 && (
              <strong
                title={truncatedName !== displayName ? displayName : undefined}
              >
                {truncatedName}
              </strong>
            )}
          </Fragment>
        ))}
      </>
    );
  }, [tDocuments, displayName, truncatedName]);

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
