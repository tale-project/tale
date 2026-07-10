'use client';

import { Text } from '@tale/ui/text';

import { createTableConfigHook } from '@/app/hooks/use-table-config-factory';

import { ContactRowActions } from '../components/contact-row-actions';

export const useContactsTableConfig = createTableConfigHook<'contacts'>(
  {
    entityNamespace: 'contacts',
    defaultSort: '_creationTime',
  },
  ({ tTables, tEntity, builders }) => [
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
      // `tables` has no phone header; the contacts namespace owns the label.
      accessorKey: 'phone',
      header: tEntity('phone'),
      size: 160,
      cell: ({ row }) => (
        <Text as="span" variant="body">
          {row.original.phone || ''}
        </Text>
      ),
    },
    builders.createSourceColumn(tTables),
    builders.createLocaleColumn(),
    builders.createCreationTimeColumn(tTables),
    builders.createActionsColumn(ContactRowActions, 'contact', {
      size: 56,
      headerLabel: tTables('headers.actions'),
    }),
  ],
);
