'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Badge } from '@/app/components/ui/feedback/badge';
import { cn } from '@/lib/utils/cn';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import type { AuditLogItem } from '@/convex/audit_logs/types';

interface AuditLogTableProps {
  logs: AuditLogItem[];
}

export function AuditLogTable({ logs }: AuditLogTableProps) {
  const { formatDate, formatRelative } = useFormatDate();
  const { t } = useT('settings');
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

  const columns = useMemo<ColumnDef<AuditLogItem>[]>(
    () => [
      {
        accessorKey: 'timestamp',
        header: t('logs.audit.columns.timestamp'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {formatRelative(new Date(row.original.timestamp))}
          </span>
        ),
        size: 140,
      },
      {
        accessorKey: 'action',
        header: t('logs.audit.columns.action'),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.action.replace(/_/g, ' ')}</span>
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
          <span className="text-sm capitalize">{row.original.resourceType}</span>
        ),
        size: 120,
      },
      {
        accessorKey: 'resourceName',
        header: t('logs.audit.columns.target'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
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
              variant={status === 'success' ? 'success' : status === 'denied' ? 'warning' : 'destructive'}
            >
              {status}
            </Badge>
          );
        },
        size: 100,
      },
    ],
    [t, formatRelative],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={logs}
        caption={t('logs.audit.tableCaption')}
        emptyState={{
          title: t('logs.audit.emptyTitle'),
          description: t('logs.audit.emptyDescription'),
        }}
        onRowClick={(row) => setSelectedLog(row.original)}
        clickableRows
      />

      <Dialog
        open={!!selectedLog}
        onOpenChange={() => setSelectedLog(null)}
        title={t('logs.audit.detailTitle')}
        className="max-w-2xl"
      >
        {selectedLog && (
          <div className="max-h-[60vh] overflow-y-auto">
            <div className="space-y-4 pr-4">
              <DetailRow
                label={t('logs.audit.columns.timestamp')}
                value={formatDate(new Date(selectedLog.timestamp), 'long')}
              />
              <DetailRow
                label={t('logs.audit.columns.action')}
                value={selectedLog.action.replace(/_/g, ' ')}
              />
              <DetailRow
                label={t('logs.audit.columns.actor')}
                value={selectedLog.actorEmail ?? selectedLog.actorId}
              />
              <DetailRow
                label={t('logs.audit.columns.actorType')}
                value={selectedLog.actorType}
              />
              {selectedLog.actorRole && (
                <DetailRow
                  label={t('logs.audit.columns.actorRole')}
                  value={selectedLog.actorRole}
                />
              )}
              <DetailRow
                label={t('logs.audit.columns.category')}
                value={selectedLog.category}
              />
              <DetailRow
                label={t('logs.audit.columns.resource')}
                value={selectedLog.resourceType}
              />
              {selectedLog.resourceId && (
                <DetailRow
                  label={t('logs.audit.columns.resourceId')}
                  value={selectedLog.resourceId}
                />
              )}
              {selectedLog.resourceName && (
                <DetailRow
                  label={t('logs.audit.columns.target')}
                  value={selectedLog.resourceName}
                />
              )}
              <DetailRow label={t('logs.audit.columns.status')} value={selectedLog.status} />
              {selectedLog.errorMessage && (
                <DetailRow
                  label={t('logs.audit.columns.error')}
                  value={selectedLog.errorMessage}
                  isError
                />
              )}
              {selectedLog.changedFields && selectedLog.changedFields.length > 0 && (
                <DetailRow
                  label={t('logs.audit.columns.changedFields')}
                  value={selectedLog.changedFields.join(', ')}
                />
              )}
              {selectedLog.previousState && (
                <DetailSection
                  label={t('logs.audit.columns.previousState')}
                  data={selectedLog.previousState}
                />
              )}
              {selectedLog.newState && (
                <DetailSection
                  label={t('logs.audit.columns.newState')}
                  data={selectedLog.newState}
                />
              )}
              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                <DetailSection
                  label={t('logs.audit.columns.metadata')}
                  data={selectedLog.metadata}
                />
              )}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

function DetailRow({
  label,
  value,
  isError = false,
}: {
  label: string;
  value: string;
  isError?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          'col-span-2 text-sm capitalize',
          isError && 'text-destructive',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function DetailSection({
  label,
  data,
}: {
  label: string;
  data: Record<string, unknown>;
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <pre className="text-xs bg-muted/50 p-3 rounded-lg overflow-auto max-h-40">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
