'use client';

import { useMemo, useCallback, useState } from 'react';
import { Eye, Pencil, Trash2, ExternalLink } from 'lucide-react';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/components/ui/entity-row-actions';
import { Id } from '@/convex/_generated/dataModel';
import { ProductViewDialog } from './product-view-dialog';
import { ProductEditDialog } from './product-edit-dialog';
import { ProductDeleteDialog } from './product-delete-dialog';
import { useDeleteProduct } from '../hooks/use-delete-product';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

interface Product {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  stock?: number;
  price?: number;
  currency?: string;
  category?: string;
  tags?: string[];
  status?: string;
  lastUpdated: number;
  metadata?: { url?: string };
}

interface ProductRowActionsProps {
  product: Product;
}

export function ProductRowActions({ product }: ProductRowActionsProps) {
  const { t: tProducts } = useT('products');
  const { t: tCommon } = useT('common');
  const dialogs = useEntityRowDialogs(['view', 'edit', 'delete']);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteProduct = useDeleteProduct();

  const handleDeleteConfirm = useCallback(async () => {
    try {
      setIsDeleting(true);
      await deleteProduct({
        productId: product.id as Id<'products'>,
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
  }, [deleteProduct, product.id, dialogs.setOpen, tProducts]);

  const handleOpenExternalLink = useCallback(() => {
    if (typeof product.metadata?.url === 'string') {
      window.open(product.metadata.url, '_blank', 'noopener,noreferrer');
    }
  }, [product.metadata?.url]);

  const hasExternalLink = typeof product.metadata?.url === 'string';

  const actions = useMemo(
    () => [
      {
        key: 'view',
        label: tCommon('actions.view'),
        icon: Eye,
        onClick: dialogs.open.view,
      },
      {
        key: 'edit',
        label: tCommon('actions.edit'),
        icon: Pencil,
        onClick: dialogs.open.edit,
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
      },
    ],
    [tCommon, dialogs.open, handleOpenExternalLink, hasExternalLink]
  );

  return (
    <>
      <EntityRowActions actions={actions} />

      {dialogs.isOpen.view && (
        <ProductViewDialog
          isOpen={dialogs.isOpen.view}
          onClose={() => dialogs.setOpen.view(false)}
          product={product}
        />
      )}

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
