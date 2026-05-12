'use client';

import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { formatDistanceToNow } from 'date-fns';
import { BarChart3 } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';
import { slugToUrlParam } from '@/lib/utils/workflow-slug';

import { formatDurationSeconds } from './format-duration';

export interface TopWorkflowRow {
  wfDefinitionId: string | null;
  workflowSlug: string | null;
  total: number;
  completed: number;
  failed: number;
  successRate: number;
  avgExecutionTimeSeconds: number;
  lastExecution: number | null;
}

interface TopWorkflowsTableProps {
  organizationId: string;
  rows: TopWorkflowRow[];
  isLoading: boolean;
}

function displayName(row: TopWorkflowRow): string {
  if (row.workflowSlug) return row.workflowSlug;
  if (row.wfDefinitionId) return row.wfDefinitionId;
  return '—';
}

export function TopWorkflowsTable({
  organizationId,
  rows,
  isLoading,
}: TopWorkflowsTableProps) {
  const navigate = useNavigate();
  const { t } = useT('automations');

  const handleRowClick = useCallback(
    (row: Row<TopWorkflowRow>) => {
      const slug = row.original.workflowSlug;
      if (!slug) return;
      void navigate({
        to: '/dashboard/$id/automations/$amId/executions',
        params: { id: organizationId, amId: slugToUrlParam(slug) },
      });
    },
    [navigate, organizationId],
  );

  const columns = useMemo<ColumnDef<TopWorkflowRow>[]>(
    () => [
      {
        id: 'workflow',
        header: t('metrics.table.workflow'),
        cell: ({ row }) => (
          <Text
            as="span"
            variant="label"
            className="block max-w-[320px] truncate text-sm"
          >
            {displayName(row.original)}
          </Text>
        ),
        size: 320,
      },
      {
        id: 'runs',
        header: () => (
          <div className="text-right">{t('metrics.table.runs')}</div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.total)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'successRate',
        header: () => (
          <div className="text-right">{t('metrics.table.successRate')}</div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {row.original.total > 0
              ? `${row.original.successRate.toFixed(1)}%`
              : '—'}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'avgDuration',
        header: () => (
          <div className="text-right">{t('metrics.table.avgDuration')}</div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatDurationSeconds(row.original.avgExecutionTimeSeconds)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'failed',
        header: () => (
          <div className="text-right">{t('metrics.table.failed')}</div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.failed)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'lastRun',
        header: t('metrics.table.lastRun'),
        cell: ({ row }) => (
          <Text as="span" variant="caption">
            {row.original.lastExecution
              ? formatDistanceToNow(new Date(row.original.lastExecution), {
                  addSuffix: true,
                })
              : '—'}
          </Text>
        ),
        size: 160,
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{t('metrics.table.title')}</h2>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) =>
          row.wfDefinitionId ?? row.workflowSlug ?? Math.random().toString()
        }
        isLoading={isLoading}
        approxRowCount={isLoading ? 5 : rows.length}
        onRowClick={handleRowClick}
        emptyState={{
          icon: BarChart3,
          title: t('metrics.empty.title'),
          description: t('metrics.empty.description'),
        }}
      />
    </div>
  );
}
