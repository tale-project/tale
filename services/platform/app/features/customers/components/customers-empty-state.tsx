'use client';

import { Users } from 'lucide-react';
import { DataTableEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';
import { CustomersActionMenu } from './customers-action-menu';
import { useT } from '@/lib/i18n/client';

interface CustomersEmptyStateProps {
  organizationId: string;
}

export function CustomersEmptyState({ organizationId }: CustomersEmptyStateProps) {
  const { t } = useT('emptyStates');

  return (
    <DataTableEmptyState
      icon={Users}
      title={t('customers.title')}
      description={t('customers.description')}
      actionMenu={<CustomersActionMenu organizationId={organizationId} />}
    />
  );
}
