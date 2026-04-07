'use client';

import { Text } from '@/app/components/ui/typography/text';
import { createTableConfigHook } from '@/app/hooks/use-table-config-factory';

import { CustomerRowActions } from '../components/customer-row-actions';
import { CustomerStatusBadge } from '../components/customer-status-badge';

export const useCustomersTableConfig = createTableConfigHook<'customers'>(
  {
    entityNamespace: 'customers',
    defaultSort: '_creationTime',
  },
  ({ tTables, builders }) => [
    builders.createSelectColumn(),
    {
      accessorKey: 'name',
      header: tTables('headers.name'),
      size: 200,
      cell: ({ row }) => (
        <Text as="span" variant="label">
          {row.original.name || ''}
        </Text>
      ),
    },
    {
      accessorKey: 'email',
      header: tTables('headers.email'),
      size: 240,
      cell: ({ row }) => (
        <Text as="span" variant="body">
          {row.original.email || tTables('cells.noEmail')}
        </Text>
      ),
    },
    {
      accessorKey: 'status',
      header: tTables('headers.status'),
      size: 140,
      cell: ({ row }) => <CustomerStatusBadge status={row.original.status} />,
    },
    builders.createSourceColumn(tTables),
    builders.createLocaleColumn(),
    builders.createCreationTimeColumn(tTables),
    builders.createActionsColumn(CustomerRowActions, 'customer', {
      size: 56,
      headerLabel: tTables('headers.actions'),
    }),
  ],
);
