'use client';

import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import type { AuditLogDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

type AuditLog = AuditLogDoc;

export type AuditLogTableVariant = 'audit' | 'errors';

interface AuditLogTableConfig {
  columns: ColumnDef<AuditLog>[];
  stickyLayout: boolean;
  pageSize: number;
}

interface UseAuditLogTableConfigOptions {
  resolveEmail?: (log: AuditLog) => string | undefined;
  /**
   * `errors` swaps the resource/target/category columns for the error
   * message — the rows are failure/denied only, so the message is the
   * column that answers "what went wrong".
   */
  variant?: AuditLogTableVariant;
}

export function useAuditLogTableConfig(
  options?: UseAuditLogTableConfigOptions,
): AuditLogTableConfig {
  const resolveEmail = options?.resolveEmail;
  const variant = options?.variant ?? 'audit';
  const { t } = useT('settings');

  // Column sizes double as the table's min-width floor (DataTable sums them).
  // Each variant's total must stay ≤ 940px so the table fits the settings
  // content column on common laptop widths instead of clipping behind a
  // horizontal scroll.
  const columns = useMemo<ColumnDef<AuditLog>[]>(() => {
    const timestampActionActor: ColumnDef<AuditLog>[] = [
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
            customFormat="MMM D, YYYY HH:mm"
            alignRight
          />
        ),
      },
      {
        accessorKey: 'action',
        header: t('logs.audit.columns.action'),
        cell: ({ row }) => (
          <Text as="span" variant="label">
            {t('logs.audit.actionLabels.' + row.original.action, {
              defaultValue: row.original.action.replace(/_/g, ' '),
            })}
          </Text>
        ),
        size: 185,
      },
      {
        accessorKey: 'actorEmail',
        header: t('logs.audit.columns.actor'),
        meta: { skeleton: { type: 'two-line' as const } },
        cell: ({ row }) => {
          const email = resolveEmail?.(row.original) ?? row.original.actorEmail;
          return (
            <div className="flex flex-col gap-0.5">
              <Text as="span" variant="body" truncate>
                {email ?? row.original.actorId}
              </Text>
              {email && (
                <Text as="span" variant="muted" truncate className="text-xs">
                  {row.original.actorId}
                </Text>
              )}
            </div>
          );
        },
        size: 175,
      },
    ];

    const auditDetail: ColumnDef<AuditLog>[] = [
      {
        accessorKey: 'resourceType',
        header: t('logs.audit.columns.resource'),
        cell: ({ row }) => (
          <Text as="span" variant="body" className="capitalize">
            {t('logs.audit.resourceTypeLabels.' + row.original.resourceType, {
              defaultValue: row.original.resourceType.replace(/_/g, ' '),
            })}
          </Text>
        ),
        size: 100,
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
        size: 140,
      },
      {
        accessorKey: 'category',
        header: t('logs.audit.columns.category'),
        meta: { skeleton: { type: 'badge' as const } },
        cell: ({ row }) => (
          // `max-w-full truncate` keeps an overlong label inside its
          // `table-fixed` column instead of spilling into the Status cell.
          <Badge variant="outline" className="max-w-full truncate capitalize">
            {t('logs.audit.categoryLabels.' + row.original.category, {
              defaultValue: row.original.category,
            })}
          </Badge>
        ),
        size: 100,
      },
    ];

    const errorMessage: ColumnDef<AuditLog>[] = [
      {
        accessorKey: 'errorMessage',
        header: t('logs.audit.columns.error'),
        cell: ({ row }) => (
          <Text
            as="span"
            variant="body"
            truncate
            className="text-destructive block max-w-[340px]"
          >
            {row.original.errorMessage ?? '-'}
          </Text>
        ),
        size: 340,
      },
    ];

    const statusColumn: ColumnDef<AuditLog>[] = [
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
              className="max-w-full truncate"
            >
              {t('logs.audit.statusLabels.' + status, {
                defaultValue: status,
              })}
            </Badge>
          );
        },
        size: 100,
      },
    ];

    return variant === 'errors'
      ? [...timestampActionActor, ...errorMessage, ...statusColumn]
      : [...timestampActionActor, ...auditDetail, ...statusColumn];
  }, [t, resolveEmail, variant]);

  return { columns, stickyLayout: true, pageSize: 30 };
}
