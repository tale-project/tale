'use client';

import { Store } from 'lucide-react';

import { DataTableEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';
import { useT } from '@/lib/i18n/client';

import { VendorsActionMenu } from './vendors-action-menu';

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
