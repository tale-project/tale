'use client';

import { Text } from '@tale/ui/text';
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

export interface TopAutomationRow {
  name: string;
  total: number;
  success: number;
  failed: number;
  successRate: number;
  avgDurationSeconds: number;
  lastRun: number | null;
}

interface TopAutomationsTableProps {
  rows: TopAutomationRow[];
  isLoading: boolean;
  /** Row click → the automation's detail page. Provided by the route so the
   *  page stays router-free (and component-testable without a provider). */
  onSelectAutomation: (name: string) => void;
}

export function TopAutomationsTable({
  rows,
  isLoading,
  onSelectAutomation,
}: TopAutomationsTableProps) {
  const { t } = useT('analytics');
  const { locale, formatNumber } = useFormatNumber();

  const handleRowClick = useCallback(
    (row: Row<TopAutomationRow>) => {
      onSelectAutomation(row.original.name);
    },
    [onSelectAutomation],
  );

  const columns = useMemo<ColumnDef<TopAutomationRow>[]>(
    () => [
      {
        id: 'automation',
        header: t('automations.table.automation'),
        cell: ({ row }) => (
          <Text
            as="span"
            variant="label"
            className="block max-w-[320px] truncate text-sm"
          >
            {row.original.name}
          </Text>
        ),
        size: 320,
      },
      {
        id: 'runs',
        header: () => (
          <div className="text-right">{t('automations.table.runs')}</div>
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
          <div className="text-right">{t('automations.table.successRate')}</div>
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
          <div className="text-right">{t('automations.table.avgDuration')}</div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatDurationSeconds(row.original.avgDurationSeconds)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'failed',
        header: () => (
          <div className="text-right">{t('automations.table.failed')}</div>
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
        header: t('automations.table.lastRun'),
        cell: ({ row }) => (
          <TableDateCell date={row.original.lastRun} preset="relative" />
        ),
        size: 160,
      },
    ],
    [t, locale, formatNumber],
  );

  return (
    <MetricsSection title={t('automations.table.title')}>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.name}
        isLoading={isLoading}
        approxRowCount={isLoading ? 5 : rows.length}
        onRowClick={handleRowClick}
        emptyState={{
          icon: BarChart3,
          title: t('automations.empty.title'),
          description: t('automations.empty.description'),
        }}
      />
    </MetricsSection>
  );
}
