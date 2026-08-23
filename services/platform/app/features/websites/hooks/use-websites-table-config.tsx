'use client';

import { Badge } from '@tale/ui/badge';
import { HStack, Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Globe, Loader } from 'lucide-react';

import { CopyableTimestamp } from '@/app/components/ui/data-display/copyable-timestamp';
import { createTableConfigHook } from '@/app/hooks/use-table-config-factory';

import { WebsiteRowActions } from '../components/website-row-actions';
import { isScanPaused } from '../lib/scan-paused';

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
    // Multi-row select — canonical 40px column matching every other entity
    // table. Enables bulk-delete via the `BulkDeleteBar` footer.
    builders.createSelectColumn(),
    {
      accessorKey: 'domain',
      header: tTables('headers.website'),
      size: 256,
      cell: ({ row }) => (
        <HStack gap={2}>
          <Row
            gap={0}
            justify="center"
            className="bg-muted size-5 shrink-0 rounded"
          >
            <Globe className="text-muted-foreground size-3" />
          </Row>
          <Text as="span" variant="label" truncate>
            {row.original.domain}
          </Text>
          {row.original.kind === 'list' && (
            <Badge variant="outline" className="shrink-0">
              {tEntity('kindList')}
            </Badge>
          )}
        </HStack>
      ),
    },
    {
      accessorKey: 'status',
      header: tTables('headers.status'),
      size: 108,
      cell: ({ row }) => {
        // Paused (repeated failures to reach the knowledge database) wins
        // over the stored status: the row keeps `error`, but "Error" alone
        // would suggest the crawler is still retrying.
        if (isScanPaused(row.original)) {
          return (
            <Badge variant="orange" dot>
              {tEntity('scanPausedBadge')}
            </Badge>
          );
        }
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
    // `title` column dropped — for monitored websites the domain (already
    // shown in the first column) is the disambiguator users scan on, and
    // page titles often duplicate the domain or fall back to "—". Users
    // who need the title still see it on the website detail view. Frees
    // 192px for the indexed/last-scanned/interval columns to breathe.
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
      cell: ({ row }) => {
        // A successful scan stamps `lastScannedAt`; until then the cell must
        // not pretend work is in progress. Show the spinner only while the
        // website is actively `scanning`, and surface a static, labelled
        // "Not scanned yet" for every terminal/idle state (freshly added,
        // `idle`, `error`, or environments where the crawler never ran).
        if (row.original.lastScannedAt) {
          return (
            <CopyableTimestamp
              date={row.original.lastScannedAt}
              preset="long"
              alignRight
            />
          );
        }
        if (row.original.status === 'scanning') {
          return (
            <Row gap={0} align="stretch" justify="end">
              <Loader
                role="status"
                aria-hidden={false}
                aria-label={tEntity('filter.status.scanning')}
                className="text-muted-foreground size-4 animate-spin"
              />
            </Row>
          );
        }
        return (
          <Text as="span" variant="caption" className="block w-full text-right">
            {tEntity('viewDialog.notScannedYet')}
          </Text>
        );
      },
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
