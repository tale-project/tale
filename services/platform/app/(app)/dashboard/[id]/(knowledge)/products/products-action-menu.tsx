'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, HardDrive } from 'lucide-react';
import { DataTableActionMenu } from '@/components/ui/data-table';
import { ShopifyIcon, CirculyIcon } from '@/components/ui/icons';
import ImportProductsDialog from './products-import-dialog';
import { useT } from '@/lib/i18n';

interface ProductsActionMenuProps {
  organizationId: string;
}

export function ProductsActionMenu({ organizationId }: ProductsActionMenuProps) {
  const { t: tProducts } = useT('products');
  const router = useRouter();
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  const handleUploadClick = useCallback(() => {
    setIsUploadDialogOpen(true);
  }, []);

  const handleShopifyClick = useCallback(() => {
    router.push(
      `/dashboard/${organizationId}/settings/integrations?tab=shopify`,
    );
  }, [router, organizationId]);

  const handleCirculyClick = useCallback(() => {
    router.push(
      `/dashboard/${organizationId}/settings/integrations?tab=circuly`,
    );
  }, [router, organizationId]);

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
      <ImportProductsDialog
        isOpen={isUploadDialogOpen}
        onClose={() => setIsUploadDialogOpen(false)}
        organizationId={organizationId}
        onSuccess={() => {
          setIsUploadDialogOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}
