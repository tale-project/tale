'use client';

import { Plus } from 'lucide-react';
import { useState, useCallback } from 'react';

import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useT } from '@/lib/i18n/client';

import { ProductsImportDialog } from './products-import-dialog';

interface ProductsActionMenuProps {
  organizationId: string;
}

export function ProductsActionMenu({
  organizationId,
}: ProductsActionMenuProps) {
  const { t: tProducts } = useT('products');
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  const handleUploadClick = useCallback(() => {
    setIsUploadDialogOpen(true);
  }, []);

  return (
    <>
      <DataTableActionMenu
        label={tProducts('importMenu.importProducts')}
        icon={Plus}
        onClick={handleUploadClick}
      />
      <ProductsImportDialog
        isOpen={isUploadDialogOpen}
        onClose={() => setIsUploadDialogOpen(false)}
        organizationId={organizationId}
        onSuccess={() => setIsUploadDialogOpen(false)}
      />
    </>
  );
}
