'use client';

import { DeleteModal } from '@/components/ui/modals';
import { useT } from '@/lib/i18n';

interface DeleteProductDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  productName: string;
  isDeleting?: boolean;
}

export default function DeleteProductDialog({
  isOpen,
  onClose,
  onConfirm,
  productName,
  isDeleting = false,
}: DeleteProductDialogProps) {
  const { t: tProducts } = useT('products');

  return (
    <DeleteModal
      open={isOpen}
      onOpenChange={() => onClose()}
      title={tProducts('delete.title')}
      description={
        <>
          {tProducts('delete.confirmation', { name: productName || tProducts('delete.thisProduct') })}{' '}
          {tProducts('delete.warning')}
        </>
      }
      isDeleting={isDeleting}
      onDelete={onConfirm}
    />
  );
}
