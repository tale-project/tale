'use client';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { useT } from '@/lib/i18n/client';

interface DeleteProductDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  productName: string;
  isDeleting?: boolean;
}

export function ProductDeleteDialog({
  isOpen,
  onClose,
  onConfirm,
  productName,
  isDeleting = false,
}: DeleteProductDialogProps) {
  const { t: tProducts } = useT('products');

  return (
    <DeleteDialog
      open={isOpen}
      onOpenChange={() => onClose()}
      title={tProducts('delete.title')}
      description={
        <>
          {tProducts('delete.confirmation', {
            name: productName || tProducts('delete.thisProduct'),
          })}{' '}
          {tProducts('delete.warning')}
        </>
      }
      isDeleting={isDeleting}
      onDelete={onConfirm}
    />
  );
}
