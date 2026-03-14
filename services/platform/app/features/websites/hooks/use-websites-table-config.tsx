'use client';

import { Globe, Loader } from 'lucide-react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { Badge } from '@/app/components/ui/feedback/badge';
import { HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { createTableConfigHook } from '@/app/hooks/use-table-config-factory';

import { WebsiteRowActions } from '../components/website-row-actions';

const statusVariant = {
  active: 'green',
  scanning: 'blue',
  idle: 'outline',
  error: 'destructive',
  deleting: 'destructive',
} as const;

export const useWebsitesTableConfig = createTableConfigHook<'websites'>(
  {
    entityNamespace: 'websites',
    defaultSort: '_creationTime',
  },
  ({ tTables, tEntity, builders }) => [
    {
      accessorKey: 'domain',
      header: tTables('headers.website'),
      size: 256,
      cell: ({ row }) => (
        <HStack gap={2}>
          <div className="bg-muted flex size-5 shrink-0 items-center justify-center rounded">
            <Globe className="text-muted-foreground size-3" />
          </div>
          <Text as="span" variant="label" truncate>
            {row.original.domain}
          </Text>
        </HStack>
      ),
    },
    {
      accessorKey: 'status',
      header: tTables('headers.status'),
      size: 108,
      cell: ({ row }) => {
        const s = row.original.status;
        const variant = s && s in statusVariant ? statusVariant[s] : 'outline';
        const statusLabels: Record<string, string> = {
          idle: tEntity('filter.status.idle'),
          scanning: tEntity('filter.status.scanning'),
          active: tEntity('filter.status.active'),
          error: tEntity('filter.status.error'),
          deleting: tEntity('filter.status.deleting'),
        };
        return (
          <Badge variant={variant} dot>
            {(s && statusLabels[s]) || s || '-'}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'title',
      header: tTables('headers.title'),
      size: 192,
      cell: ({ row }) => (
        <Text as="div" truncate className="max-w-sm">
          {row.original.title || tTables('cells.empty')}
        </Text>
      ),
    },
    {
      id: 'indexed',
      header: () => (
        <span className="block w-full text-right">{tEntity('indexed')}</span>
      ),
      size: 80,
      meta: { headerLabel: tEntity('indexed') },
      cell: ({ row }) => (
        <Text as="span" variant="caption" className="block w-full text-right">
          {row.original.crawledPageCount ?? 0}
        </Text>
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
      cell: ({ row }) => {
        const intervalLabels: Record<string, string> = {
          '60m': tEntity('scanIntervals.1hour'),
          '6h': tEntity('scanIntervals.6hours'),
          '12h': tEntity('scanIntervals.12hours'),
          '1d': tEntity('scanIntervals.1day'),
          '5d': tEntity('scanIntervals.5days'),
          '7d': tEntity('scanIntervals.7days'),
          '30d': tEntity('scanIntervals.30days'),
        };
        const val = row.original.scanInterval;
        return (
          <Text as="span" variant="caption" className="block w-full text-right">
            {intervalLabels[val] || val}
          </Text>
        );
      },
    },
    builders.createActionsColumn(WebsiteRowActions, 'website', {
      size: 56,
      headerLabel: tTables('headers.actions'),
    }),
  ],
);
