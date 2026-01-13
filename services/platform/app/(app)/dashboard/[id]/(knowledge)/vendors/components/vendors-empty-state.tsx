'use client';

import { Store } from 'lucide-react';
import { DataTableEmptyState } from '@/components/ui/data-table/data-table-empty-state';
import { VendorsActionMenu } from './vendors-action-menu';
import { useT } from '@/lib/i18n/client';

interface VendorsEmptyStateProps {
  organizationId: string;
}

export function VendorsEmptyState({ organizationId }: VendorsEmptyStateProps) {
  const { t } = useT('emptyStates');

  return (
    <DataTableEmptyState
      icon={Store}
      title={t('vendors.title')}
      description={t('vendors.description')}
      actionMenu={<VendorsActionMenu organizationId={organizationId} />}
    />
  );
}
