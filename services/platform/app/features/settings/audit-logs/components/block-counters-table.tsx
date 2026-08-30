'use client';

import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { ShieldOff } from 'lucide-react';
import { useMemo } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface BlockCountersTableProps {
  organizationId: string;
}

interface BlockCounterRow {
  _id: string;
  email: string;
  windowStart: number;
  lockoutCount: number;
  ipLimitCount: number;
  lastIp?: string;
}

export function BlockCountersTable({
  organizationId,
}: BlockCountersTableProps) {
  const { t } = useT('settings');
  const { t: tTables } = useT('tables');
  const { data, isLoading } = useConvexQuery(
    'login_attempts/queries:listBlockCounters',
    { organizationId, limit: 200 },
  );

  const rows: BlockCounterRow[] = useMemo(() => data ?? [], [data]);

  const columns = useMemo<ColumnDef<BlockCounterRow>[]>(
    () => [
      {
        accessorKey: 'windowStart',
        header: t('logs.blockCounters.columns.timestamp'),
        size: 180,
        cell: ({ row }) => (
          <TableDateCell
            date={row.original.windowStart}
            customFormat="MMM D, YYYY HH:mm"
          />
        ),
      },
      {
        accessorKey: 'email',
        header: t('logs.blockCounters.columns.user'),
        cell: ({ row }) => (
          <Text as="span" variant="muted" truncate>
            {row.original.email}
          </Text>
        ),
      },
      {
        accessorKey: 'lastIp',
        header: t('logs.blockCounters.columns.ipAddress'),
        size: 160,
        cell: ({ row }) => (
          <Text as="span" variant="muted">
            {row.original.lastIp ?? tTables('cells.empty')}
          </Text>
        ),
      },
      {
        accessorKey: 'lockoutCount',
        header: t('logs.blockCounters.columns.lockOut'),
        size: 140,
        cell: ({ row }) => {
          const isLockedOut = row.original.lockoutCount > 0;
          return (
            <span
              className={cn(
                'text-sm',
                isLockedOut ? 'text-destructive' : 'text-success',
              )}
            >
              {isLockedOut
                ? t('logs.blockCounters.values.yes')
                : t('logs.blockCounters.values.no')}
            </span>
          );
        },
      },
      {
        accessorKey: 'ipLimitCount',
        header: t('logs.blockCounters.columns.ipLimit'),
        size: 100,
        cell: ({ row }) => (
          <Text as="span" variant="muted" className="tabular-nums">
            {row.original.ipLimitCount}
          </Text>
        ),
      },
    ],
    [t, tTables],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      caption={t('logs.blockCounters.tableCaption')}
      isLoading={isLoading}
      emptyState={{
        icon: ShieldOff,
        title: t('logs.blockCounters.emptyTitle'),
        description: t('logs.blockCounters.empty'),
      }}
      footer={
        rows.length > 0 ? (
          <Row gap={0} className="border-border h-10 border-t px-4">
            <Text variant="muted" className="text-xs">
              {t('logs.blockCounters.footerCount', { count: rows.length })}
            </Text>
          </Row>
        ) : undefined
      }
    />
  );
}
