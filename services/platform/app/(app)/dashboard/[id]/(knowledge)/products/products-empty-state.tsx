'use client';

import { Package } from 'lucide-react';
import { DataTableEmptyState } from '@/components/ui/data-table';
import ImportProductsMenu from './import-products-menu';
import { useT } from '@/lib/i18n';

interface ProductsEmptyStateProps {
  organizationId: string;
}

export function ProductsEmptyState({ organizationId }: ProductsEmptyStateProps) {
  const { t } = useT('emptyStates');
  return (
    <DataTableEmptyState
      icon={Package}
      title={t('products.title')}
      description={t('products.description')}
      action={<ImportProductsMenu organizationId={organizationId} />}
    />
  );
}
