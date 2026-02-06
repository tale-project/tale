'use client';

import { usePaginatedQuery } from 'convex/react';
import { Users } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { CustomersActionMenu } from './customers-action-menu';
import { useCustomersTableConfig } from '../hooks/use-customers-table-config';
import { useT } from '@/lib/i18n/client';
import { useListPage } from '@/app/hooks/use-list-page';

export interface CustomersTableProps {
  organizationId: string;
}

export function CustomersTable({ organizationId }: CustomersTableProps) {
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tCustomers } = useT('customers');
  const { t: tGlobal } = useT('global');

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useCustomersTableConfig();

  const paginatedResult = usePaginatedQuery(
    api.customers.queries.listCustomers,
    { organizationId },
    { initialNumItems: pageSize },
  );

  const list = useListPage({
    dataSource: { type: 'paginated', ...paginatedResult },
    pageSize,
    search: {
      fields: ['name', 'email', 'externalId'],
      placeholder: searchPlaceholder,
    },
    filters: {
      definitions: [
        {
          key: 'status',
          title: tTables('headers.status'),
          options: [
            { value: 'active', label: tCustomers('filter.status.active') },
            {
              value: 'potential',
              label: tCustomers('filter.status.potential'),
            },
            { value: 'churned', label: tCustomers('filter.status.churned') },
            { value: 'lost', label: tCustomers('filter.status.lost') },
          ],
        },
        {
          key: 'source',
          title: tTables('headers.source'),
          options: [
            {
              value: 'manual_import',
              label: tCustomers('filter.source.manual'),
            },
            { value: 'file_upload', label: tCustomers('filter.source.upload') },
            { value: 'circuly', label: tCustomers('filter.source.circuly') },
          ],
        },
        {
          key: 'locale',
          title: tTables('headers.locale'),
          options: [
            { value: 'en', label: tGlobal('languageCodes.en') },
            { value: 'es', label: tGlobal('languageCodes.es') },
            { value: 'fr', label: tGlobal('languageCodes.fr') },
            { value: 'de', label: tGlobal('languageCodes.de') },
            { value: 'it', label: tGlobal('languageCodes.it') },
            { value: 'pt', label: tGlobal('languageCodes.pt') },
            { value: 'nl', label: tGlobal('languageCodes.nl') },
            { value: 'zh', label: tGlobal('languageCodes.zh') },
          ],
          grid: true,
        },
      ],
    },
  });

  return (
    <DataTable
      columns={columns}
      stickyLayout={stickyLayout}
      actionMenu={<CustomersActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Users,
        title: tEmpty('customers.title'),
        description: tEmpty('customers.description'),
      }}
      {...list.tableProps}
    />
  );
}
