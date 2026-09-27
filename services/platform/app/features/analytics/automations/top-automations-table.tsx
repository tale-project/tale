'use client';

import { DataTable } from '@tale/ui/data-table/data-table';
import { MetricsSection } from '@tale/ui/metrics/metrics-section';
import { TableDateCell } from '@tale/ui/table-date-cell';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';
import {
  formatDurationSeconds,
  formatSuccessRate,
} from '@/lib/utils/format/duration';

import { DrilldownButton } from '../components/drilldown-button';

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
          <DrilldownButton
            name={row.original.name}
            onSelect={() => onSelectAutomation(row.original.name)}
            className="max-w-full"
          />
        ),
        // The first column takes the slack; this is its floor.
        size: 200,
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
        // The French header "Exécutions" over a count the metrics scan caps
        // at 5,000 runs.
        size: 100,
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
        // The French header "Taux de réussite" over "100,0 %".
        size: 136,
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
        // The French header "Durée moyenne" over a duration like "59m 59s".
        size: 132,
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
        // The German header "Fehlgeschlagen" over a count.
        size: 132,
        meta: { align: 'right' as const },
      },
      {
        id: 'lastRun',
        header: t('automations.table.lastRun'),
        cell: ({ row }) => (
          <TableDateCell date={row.original.lastRun} preset="relative" />
        ),
        // Every relative time up to French "il y a quelques secondes", which
        // an automation that runs every minute shows most of the time.
        size: 188,
      },
    ],
    [t, locale, formatNumber, onSelectAutomation],
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
