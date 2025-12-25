'use client';

import { useState } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';
import { Id } from '@/convex/_generated/dataModel';
import DeleteProductDialog from './delete-product-dialog';
import ViewProductDialog from './view-product-dialog';
import EditProductDialog from './edit-product-dialog';
import { useDeleteProduct } from './hooks';

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
  metadata?: Record<string, unknown>;
}

interface ProductActionsProps {
  product: Product;
  onActionComplete?: () => void;
}

export default function ProductActions({
  product,
  onActionComplete,
}: ProductActionsProps) {
  const { t: tProducts } = useT('products');
  const { t: tCommon } = useT('common');
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteProduct = useDeleteProduct();

  const handleDeleteProduct = async () => {
    try {
      setIsDeleting(true);

      await deleteProduct({
        productId: product.id as Id<'products'>,
      });

      setIsDeleteDialogOpen(false);

      if (onActionComplete) {
        onActionComplete();
      }
    } catch (err) {
      console.error('Deletion error:', err);
      toast({
        title: tProducts('actions.deleteFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      {/* View action */}
      <button
        onClick={() => setIsViewDialogOpen(true)}
        className="flex items-center w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded"
      >
        <Eye className="size-4 mr-2" />
        {tCommon('actions.view')}
      </button>

      {/* Edit action */}
      <button
        onClick={() => setIsEditDialogOpen(true)}
        className="flex items-center w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded"
      >
        <Pencil className="size-4 mr-2" />
        {tCommon('actions.edit')}
      </button>

      {/* Delete action */}
      <button
        onClick={() => setIsDeleteDialogOpen(true)}
        className="flex items-center w-full text-left px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 rounded"
      >
        <Trash2 className="size-4 mr-2" />
        {tCommon('actions.delete')}
      </button>

      {/* Dialogs */}
      <ViewProductDialog
        isOpen={isViewDialogOpen}
        onClose={() => setIsViewDialogOpen(false)}
        product={product}
      />

      <EditProductDialog
        isOpen={isEditDialogOpen}
        onClose={() => setIsEditDialogOpen(false)}
        product={product}
      />

      <DeleteProductDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteProduct}
        productName={product.name}
        isDeleting={isDeleting}
      />
    </>
  );
}
