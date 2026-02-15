'use client';

import { Stack } from '@/app/components/ui/layout/layout';
import { createTableConfigHook } from '@/app/hooks/use-table-config-factory';

import { VendorRowActions } from '../components/vendor-row-actions';

export const useVendorsTableConfig = createTableConfigHook<'vendors'>(
  {
    entityNamespace: 'vendors',
    defaultSort: '_creationTime',
  },
  ({ tTables, builders }) => [
    {
      accessorKey: 'name',
      header: tTables('headers.name'),
      size: 408,
      cell: ({ row }) => (
        <Stack gap={0}>
          <span className="text-foreground block text-sm font-medium">
            {row.original.name || ''}
          </span>
          <span className="text-muted-foreground block text-xs">
            {row.original.email || tTables('cells.noEmail')}
          </span>
        </Stack>
      ),
    },
    builders.createSourceColumn(tTables),
    builders.createLocaleColumn(),
    builders.createCreationTimeColumn(tTables),
    builders.createActionsColumn(VendorRowActions, 'vendor', {
      headerLabel: tTables('headers.actions'),
    }),
  ],
);
