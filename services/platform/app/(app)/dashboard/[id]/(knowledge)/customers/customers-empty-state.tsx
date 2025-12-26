'use client';

import { Users } from 'lucide-react';
import { DataTableEmptyState } from '@/components/ui/data-table';
import ImportCustomersMenu from './import-customers-menu';
import { useT } from '@/lib/i18n';

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
      action={<ImportCustomersMenu organizationId={organizationId} />}
    />
  );
}
