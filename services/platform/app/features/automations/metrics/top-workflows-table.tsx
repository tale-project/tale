'use client';

import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { MetricsSection } from '@/app/components/metrics/metrics-section';
import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';
import {
  formatDurationSeconds,
  formatSuccessRate,
} from '@/lib/utils/format/duration';
import { slugToUrlParam } from '@/lib/utils/workflow-slug';

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
  const { locale, formatNumber } = useFormatNumber();

  const handleRowClick = useCallback(
    (row: Row<TopWorkflowRow>) => {
      const slug = row.original.workflowSlug;
      if (!slug) return;
      void navigate({
        to: '/dashboard/$id/workflows/$workflowId/executions',
        params: { id: organizationId, workflowId: slugToUrlParam(slug) },
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
            {formatSuccessRate(
              row.original.total,
              row.original.successRate,
              locale,
            )}
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
          <TableDateCell date={row.original.lastExecution} preset="relative" />
        ),
        size: 160,
      },
    ],
    [t, locale, formatNumber],
  );

  return (
    <MetricsSection title={t('metrics.table.title')}>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.wfDefinitionId ?? row.workflowSlug ?? 'unknown'}
        isLoading={isLoading}
        approxRowCount={isLoading ? 5 : rows.length}
        onRowClick={handleRowClick}
        isRowClickable={(row) => !!row.original.workflowSlug}
        emptyState={{
          icon: BarChart3,
          title: t('metrics.empty.title'),
          description: t('metrics.empty.description'),
        }}
      />
    </MetricsSection>
  );
}
