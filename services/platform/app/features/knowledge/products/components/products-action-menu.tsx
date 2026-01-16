'use client';

import { useState, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Plus, HardDrive } from 'lucide-react';
import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { ShopifyIcon } from '@/app/components/icons/shopify-icon';
import { CirculyIcon } from '@/app/components/icons/circuly-icon';
import { ProductsImportDialog } from './products-import-dialog';
import { useT } from '@/lib/i18n/client';

interface ProductsActionMenuProps {
  organizationId: string;
}

export function ProductsActionMenu({ organizationId }: ProductsActionMenuProps) {
  const { t: tProducts } = useT('products');
  const navigate = useNavigate();
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  const handleUploadClick = useCallback(() => {
    setIsUploadDialogOpen(true);
  }, []);

  const handleShopifyClick = useCallback(() => {
    navigate({
      to: '/dashboard/$id/settings/integrations',
      params: { id: organizationId },
      search: { tab: 'shopify' },
    });
  }, [navigate, organizationId]);

  const handleCirculyClick = useCallback(() => {
    navigate({
      to: '/dashboard/$id/settings/integrations',
      params: { id: organizationId },
      search: { tab: 'circuly' },
    });
  }, [navigate, organizationId]);

  return (
    <>
      <DataTableActionMenu
        label={tProducts('importMenu.importProducts')}
        icon={Plus}
        menuItems={[
          {
            label: tProducts('importMenu.fromDevice'),
            icon: HardDrive,
            onClick: handleUploadClick,
          },
          {
            label: tProducts('importMenu.fromShopify'),
            icon: ShopifyIcon,
            onClick: handleShopifyClick,
          },
          {
            label: tProducts('importMenu.fromCirculy'),
            icon: CirculyIcon,
            onClick: handleCirculyClick,
          },
        ]}
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
