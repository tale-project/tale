'use client';

import { EntityDeleteDialog } from '@tale/ui/entity/entity-delete-dialog';
import { useDeleteDialogTranslations } from '@tale/ui/entity/use-delete-dialog';
import { type RefObject, useCallback } from 'react';

import type { ProductDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { useDeleteProduct } from '../hooks/mutations';

interface DeleteProductDialogProps {
  isOpen: boolean;
  onClose: () => void;
  product: ProductDoc;
  /** Stable focus target when the opener (a row menu item) unmounts. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

export function ProductDeleteDialog({
  isOpen,
  onClose,
  product,
  restoreFocusRef,
}: DeleteProductDialogProps) {
  const { t: tProducts } = useT('products');
  const { t: tToast } = useT('toast');
  const { mutateAsync: deleteProduct } = useDeleteProduct();

  const translations = useDeleteDialogTranslations({
    tEntity: tProducts,
    tToast,
    keys: {
      title: 'delete.title',
      description: 'delete.confirmation',
      warningText: 'delete.warning',
      errorMessage: 'actions.deleteFailed',
    },
  });

  const handleDelete = useCallback(
    async (p: ProductDoc) => {
      await deleteProduct({ productId: p._id });
    },
    [deleteProduct],
  );

  const getEntityName = useCallback(
    (p: ProductDoc) => p.name || tProducts('delete.thisProduct'),
    [tProducts],
  );

  return (
    <EntityDeleteDialog
      isOpen={isOpen}
      onClose={onClose}
      entity={product}
      getEntityName={getEntityName}
      deleteMutation={handleDelete}
      translations={translations}
      restoreFocusRef={restoreFocusRef}
    />
  );
}
