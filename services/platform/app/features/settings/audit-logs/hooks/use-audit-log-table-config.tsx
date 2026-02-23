'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { Badge } from '@/app/components/ui/feedback/badge';
import { useT } from '@/lib/i18n/client';

type AuditLog = Doc<'auditLogs'>;

interface AuditLogTableConfig {
  columns: ColumnDef<AuditLog>[];
  stickyLayout: boolean;
  pageSize: number;
}

export function useAuditLogTableConfig(): AuditLogTableConfig {
  const { t } = useT('settings');

  const columns = useMemo<ColumnDef<AuditLog>[]>(
    () => [
      {
        accessorKey: 'timestamp',
        header: () => (
          <span className="block w-full text-right">
            {t('logs.audit.columns.timestamp')}
          </span>
        ),
        size: 140,
        meta: { headerLabel: t('logs.audit.columns.timestamp') },
        cell: ({ row }) => (
          <TableDateCell
            date={row.original.timestamp}
            preset="relative"
            alignRight
          />
        ),
      },
      {
        accessorKey: 'action',
        header: t('logs.audit.columns.action'),
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.action.replace(/_/g, ' ')}
          </span>
        ),
        size: 160,
      },
      {
        accessorKey: 'actorEmail',
        header: t('logs.audit.columns.actor'),
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.actorEmail ?? row.original.actorId}
          </span>
        ),
        size: 200,
      },
      {
        accessorKey: 'resourceType',
        header: t('logs.audit.columns.resource'),
        cell: ({ row }) => (
          <span className="text-sm capitalize">
            {row.original.resourceType}
          </span>
        ),
        size: 120,
      },
      {
        accessorKey: 'resourceName',
        header: t('logs.audit.columns.target'),
        cell: ({ row }) => (
          <span className="text-muted-foreground block max-w-[200px] truncate text-sm">
            {row.original.resourceName ?? row.original.resourceId ?? '-'}
          </span>
        ),
        size: 200,
      },
      {
        accessorKey: 'category',
        header: t('logs.audit.columns.category'),
        cell: ({ row }) => (
          <Badge variant="outline" className="capitalize">
            {row.original.category}
          </Badge>
        ),
        size: 100,
      },
      {
        accessorKey: 'status',
        header: t('logs.audit.columns.status'),
        cell: ({ row }) => {
          const status = row.original.status;
          return (
            <Badge
              variant={
                status === 'success'
                  ? 'green'
                  : status === 'denied'
                    ? 'yellow'
                    : 'destructive'
              }
            >
              {status}
            </Badge>
          );
        },
        size: 100,
      },
    ],
    [t],
  );

  return { columns, stickyLayout: true, pageSize: 30 };
}
