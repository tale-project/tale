'use client';

import { Stack } from '@/app/components/ui/layout/layout';
import { VendorRowActions } from '../components/vendor-row-actions';
import { createTableConfigHook } from '@/app/hooks/use-table-config-factory';

export const useVendorsTableConfig = createTableConfigHook<'vendors'>(
  {
    entityNamespace: 'vendors',
    defaultSort: '_creationTime',
  },
  ({ tTables, builders }) => [
    {
      accessorKey: 'name',
      header: () => tTables('headers.name'),
      size: 408,
      cell: ({ row }) => (
        <Stack gap={1}>
          <span className="font-medium text-sm text-foreground">
            {row.original.name || ''}
          </span>
          <span className="text-xs text-muted-foreground">
            {row.original.email || tTables('cells.noEmail')}
          </span>
        </Stack>
      ),
    },
    builders.createSourceColumn(tTables),
    builders.createLocaleColumn({ uppercase: true }),
    builders.createCreationTimeColumn(tTables),
    builders.createActionsColumn(VendorRowActions, 'vendor', {
      headerLabel: tTables('headers.actions'),
    }),
  ],
);
