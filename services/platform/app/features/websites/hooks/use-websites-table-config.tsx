'use client';

import { Loader } from 'lucide-react';

import { WebsiteIcon } from '@/app/components/icons/website-icon';
import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { HStack } from '@/app/components/ui/layout/layout';
import { createTableConfigHook } from '@/app/hooks/use-table-config-factory';

import { WebsiteRowActions } from '../components/website-row-actions';

export const useWebsitesTableConfig = createTableConfigHook<'websites'>(
  {
    entityNamespace: 'websites',
    defaultSort: '_creationTime',
  },
  ({ tTables, builders }) => [
    {
      accessorKey: 'domain',
      header: tTables('headers.website'),
      size: 256,
      cell: ({ row }) => (
        <HStack gap={2}>
          <div className="bg-muted flex size-5 shrink-0 items-center justify-center rounded">
            <WebsiteIcon className="text-muted-foreground size-3" />
          </div>
          <span className="text-foreground truncate text-sm font-medium">
            {row.original.domain}
          </span>
        </HStack>
      ),
    },
    {
      accessorKey: 'title',
      header: tTables('headers.title'),
      size: 192,
      cell: ({ row }) => (
        <div className="text-foreground max-w-sm truncate text-sm">
          {row.original.title || tTables('cells.empty')}
        </div>
      ),
    },
    {
      accessorKey: 'description',
      header: tTables('headers.description'),
      size: 256,
      cell: ({ row }) => (
        <div className="text-muted-foreground max-w-sm truncate text-xs">
          {row.original.description
            ? `"${row.original.description}"`
            : tTables('cells.empty')}
        </div>
      ),
    },
    {
      accessorKey: 'lastScannedAt',
      header: () => (
        <span className="block w-full text-right">
          {tTables('headers.scanned')}
        </span>
      ),
      size: 128,
      meta: { headerLabel: tTables('headers.scanned') },
      cell: ({ row }) =>
        row.original.lastScannedAt ? (
          <TableDateCell
            date={row.original.lastScannedAt}
            preset="short"
            alignRight
          />
        ) : (
          <div className="flex justify-end">
            <Loader className="text-muted-foreground size-4 animate-spin" />
          </div>
        ),
    },
    {
      accessorKey: 'scanInterval',
      header: () => (
        <span className="block w-full text-right">
          {tTables('headers.interval')}
        </span>
      ),
      size: 96,
      meta: { headerLabel: tTables('headers.interval') },
      cell: ({ row }) => (
        <span className="text-muted-foreground block w-full text-right text-xs">
          {row.original.scanInterval}
        </span>
      ),
    },
    builders.createActionsColumn(WebsiteRowActions, 'website', {
      size: 128,
      headerLabel: tTables('headers.actions'),
    }),
  ],
);
