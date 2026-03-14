'use client';

import { Pencil, Trash2, ExternalLink } from 'lucide-react';
import { useMemo, useCallback, useState } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { useAbility } from '@/app/hooks/use-ability';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import type { Product } from '../hooks/use-products-table-config';

import { useDeleteProduct } from '../hooks/mutations';
import { ProductDeleteDialog } from './product-delete-dialog';
import { ProductEditDialog } from './product-edit-dialog';

interface ProductRowActionsProps {
  product: Product;
}

export function ProductRowActions({ product }: ProductRowActionsProps) {
  const { t: tProducts } = useT('products');
  const { t: tCommon } = useT('common');
  const ability = useAbility();
  const canWrite = ability.can('write', 'knowledgeWrite');
  const dialogs = useEntityRowDialogs(['edit', 'delete']);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteProduct = useDeleteProduct();

  const handleDeleteConfirm = useCallback(async () => {
    try {
      setIsDeleting(true);
      await deleteProduct.mutateAsync({
        productId: product._id,
      });
      dialogs.setOpen.delete(false);
    } catch (err) {
      console.error('Deletion error:', err);
      toast({
        title: tProducts('actions.deleteFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteProduct, product._id, dialogs.setOpen, tProducts]);

  const handleOpenExternalLink = useCallback(() => {
    if (typeof product.metadata?.url === 'string') {
      window.open(product.metadata.url, '_blank', 'noopener,noreferrer');
    }
  }, [product.metadata?.url]);

  const hasExternalLink = typeof product.metadata?.url === 'string';

  const actions = useMemo(
    () => [
      {
        key: 'edit',
        label: tCommon('actions.edit'),
        icon: Pencil,
        onClick: dialogs.open.edit,
        visible: canWrite,
      },
      {
        key: 'external',
        label: tCommon('actions.viewSource'),
        icon: ExternalLink,
        onClick: handleOpenExternalLink,
        visible: hasExternalLink,
        separator: true,
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        onClick: dialogs.open.delete,
        destructive: true,
        separator: !hasExternalLink,
        visible: canWrite,
      },
    ],
    [tCommon, dialogs.open, handleOpenExternalLink, hasExternalLink, canWrite],
  );

  if (!canWrite) return null;

  return (
    <>
      <EntityRowActions actions={actions} />

      {dialogs.isOpen.edit && (
        <ProductEditDialog
          isOpen={dialogs.isOpen.edit}
          onClose={() => dialogs.setOpen.edit(false)}
          product={product}
        />
      )}

      <ProductDeleteDialog
        isOpen={dialogs.isOpen.delete}
        onClose={() => dialogs.setOpen.delete(false)}
        onConfirm={handleDeleteConfirm}
        productName={product.name}
        isDeleting={isDeleting}
      />
    </>
  );
}
