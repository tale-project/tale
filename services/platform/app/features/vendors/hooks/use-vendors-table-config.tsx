'use client';

import { Text } from '@/app/components/ui/typography/text';
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
    builders.createSourceColumn(tTables),
    builders.createLocaleColumn(),
    builders.createCreationTimeColumn(tTables),
    builders.createActionsColumn(VendorRowActions, 'vendor', {
      size: 56,
      headerLabel: tTables('headers.actions'),
    }),
  ],
);
