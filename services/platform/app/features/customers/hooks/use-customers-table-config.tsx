'use client';

import { Stack } from '@/app/components/ui/layout/layout';
import { createTableConfigHook } from '@/app/hooks/use-table-config-factory';

import { CustomerRowActions } from '../components/customer-row-actions';
import { CustomerStatusBadge } from '../components/customer-status-badge';

export const useCustomersTableConfig = createTableConfigHook<'customers'>(
  {
    entityNamespace: 'customers',
    defaultSort: '_creationTime',
  },
  ({ tTables, builders }) => [
    {
      accessorKey: 'name',
      header: tTables('headers.name'),
      size: 278,
      cell: ({ row }) => (
        <Stack gap={1}>
          <span className="text-foreground text-sm font-medium">
            {row.original.name || ''}
          </span>
          <span className="text-muted-foreground text-xs">
            {row.original.email || tTables('cells.noEmail')}
          </span>
        </Stack>
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
      headerLabel: tTables('headers.actions'),
    }),
  ],
);
