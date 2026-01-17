'use client';

import { Package } from 'lucide-react';
import { DataTableEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';
import { ProductsActionMenu } from './products-action-menu';
import { useT } from '@/lib/i18n/client';

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
      actionMenu={<ProductsActionMenu organizationId={organizationId} />}
    />
  );
}
