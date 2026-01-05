'use client';

import { useMemo } from 'react';
import { Loader } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import type { Doc } from '@/convex/_generated/dataModel';
import { HStack } from '@/components/ui/layout';
import { WebsiteIcon } from '@/components/icons';
import { TableDateCell } from '@/components/ui/table-date-cell';
import { WebsiteRowActions } from '../components/website-row-actions';
import { useT } from '@/lib/i18n';

/** Shared table configuration for websites - used by both table and skeleton */
export function useWebsitesTableConfig() {
  const { t: tTables } = useT('tables');
  const { t: tWebsites } = useT('websites');

  const columns = useMemo<ColumnDef<Doc<'websites'>>[]>(
    () => [
      {
        accessorKey: 'domain',
        header: tTables('headers.website'),
        size: 256,
        cell: ({ row }) => (
          <HStack gap={2}>
            <div className="flex-shrink-0 size-5 rounded flex items-center justify-center bg-muted">
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
        header: tTables('headers.title'),
        size: 192,
        cell: ({ row }) => (
          <span className="text-sm text-foreground truncate">
            {row.original.title || tTables('cells.empty')}
          </span>
        ),
      },
      {
        accessorKey: 'description',
        header: tTables('headers.description'),
        size: 256,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate">
            {row.original.description || tTables('cells.empty')}
          </span>
        ),
      },
      {
        accessorKey: 'lastScannedAt',
        header: tTables('headers.scanned'),
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
        header: tTables('headers.interval'),
        size: 96,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.scanInterval}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => (
          <span className="sr-only">{tTables('headers.actions')}</span>
        ),
        size: 128,
        meta: { isAction: true },
        cell: ({ row }) => (
          <HStack justify="end">
            <WebsiteRowActions website={row.original} />
          </HStack>
        ),
      },
    ],
    [tTables],
  );

  return {
    columns,
    searchPlaceholder: tWebsites('searchPlaceholder'),
    stickyLayout: true as const,
    pageSize: 10,
    defaultSort: '_creationTime' as const,
    defaultSortDesc: true,
  };
}
