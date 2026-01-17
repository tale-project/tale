'use client';

import { Loader } from 'lucide-react';
import { HStack } from '@/app/components/ui/layout/layout';
import { WebsiteIcon } from '@/app/components/icons/website-icon';
import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { WebsiteRowActions } from '../components/website-row-actions';
import { createTableConfigHook } from '@/app/hooks/use-table-config-factory';

export const useWebsitesTableConfig = createTableConfigHook<'websites'>(
  {
    entityNamespace: 'websites',
    defaultSort: '_creationTime',
  },
  ({ tTables, builders }) => [
    {
      accessorKey: 'domain',
      header: () => tTables('headers.website'),
      size: 256,
      cell: ({ row }) => (
        <HStack gap={2}>
          <div className="shrink-0 size-5 rounded flex items-center justify-center bg-muted">
            <WebsiteIcon className="size-3 text-muted-foreground" />
          </div>
          <span className="font-medium text-sm text-foreground truncate">
            {row.original.domain}
          </span>
        </HStack>
      ),
    },
    {
      accessorKey: 'title',
      header: () => tTables('headers.title'),
      size: 192,
      cell: ({ row }) => (
        <span className="text-sm text-foreground truncate">
          {row.original.title || tTables('cells.empty')}
        </span>
      ),
    },
    {
      accessorKey: 'description',
      header: () => tTables('headers.description'),
      size: 256,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground truncate">
          {row.original.description || tTables('cells.empty')}
        </span>
      ),
    },
    {
      accessorKey: 'lastScannedAt',
      header: () => tTables('headers.scanned'),
      size: 128,
      cell: ({ row }) =>
        row.original.lastScannedAt ? (
          <TableDateCell
            date={row.original.lastScannedAt}
            preset="short"
            className="text-xs"
          />
        ) : (
          <Loader className="size-4 animate-spin text-muted-foreground" />
        ),
    },
    {
      accessorKey: 'scanInterval',
      header: () => tTables('headers.interval'),
      size: 96,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
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
