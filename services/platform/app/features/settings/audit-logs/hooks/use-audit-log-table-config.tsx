'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Text } from '@/app/components/ui/typography/text';
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
          <Text as="span" align="right" className="block w-full">
            {t('logs.audit.columns.timestamp')}
          </Text>
        ),
        size: 140,
        meta: {
          headerLabel: t('logs.audit.columns.timestamp'),
          align: 'right' as const,
        },
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
          <Text as="span" variant="label">
            {row.original.action.replace(/_/g, ' ')}
          </Text>
        ),
        size: 160,
      },
      {
        accessorKey: 'actorEmail',
        header: t('logs.audit.columns.actor'),
        cell: ({ row }) => (
          <Text as="span" variant="body">
            {row.original.actorEmail ?? row.original.actorId}
          </Text>
        ),
        size: 200,
      },
      {
        accessorKey: 'resourceType',
        header: t('logs.audit.columns.resource'),
        cell: ({ row }) => (
          <Text as="span" variant="body" className="capitalize">
            {row.original.resourceType}
          </Text>
        ),
        size: 120,
      },
      {
        accessorKey: 'resourceName',
        header: t('logs.audit.columns.target'),
        cell: ({ row }) => (
          <Text
            as="span"
            variant="muted"
            truncate
            className="block max-w-[200px]"
          >
            {row.original.resourceName ?? row.original.resourceId ?? '-'}
          </Text>
        ),
        size: 200,
      },
      {
        accessorKey: 'category',
        header: t('logs.audit.columns.category'),
        meta: { skeleton: { type: 'badge' as const } },
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
        meta: { skeleton: { type: 'badge' as const } },
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
