'use client';

import { Badge } from '@tale/ui/badge';
import { DataTable } from '@tale/ui/data-table/data-table';
import { MetricsSection } from '@tale/ui/metrics/metrics-section';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';

import { DrilldownButton } from '../components/drilldown-button';
import { modelRowNames } from '../components/model-row-name';

export interface TopModelRow {
  provider: string;
  model: string;
  requests: number;
  tokens: number;
  costCents: number;
}

interface TopModelsTableProps {
  rows: TopModelRow[];
  isLoading: boolean;
  /** Narrows the page to the row's model as its provider serves it. */
  onSelectModel: (model: string, provider: string) => void;
}

export function TopModelsTable({
  rows,
  isLoading,
  onSelectModel,
}: TopModelsTableProps) {
  const { t } = useT('analytics');
  const { formatNumber, formatCostCents } = useFormatNumber();

  const handleRowClick = useCallback(
    (row: Row<TopModelRow>) => {
      onSelectModel(row.original.model, row.original.provider);
    },
    [onSelectModel],
  );
  // A model the table holds through two providers is named with each, so
  // the two rows' filters do not share one name.
  const nameOf = useMemo(() => modelRowNames(rows), [rows]);

  const columns = useMemo<ColumnDef<TopModelRow>[]>(
    () => [
      {
        id: 'model',
        header: t('usage.tables.topModels.model'),
        meta: { skeleton: { type: 'text-badge' } },
        cell: ({ row }) => (
          <div className="flex max-w-[260px] items-center gap-2">
            <DrilldownButton
              name={nameOf(row.original)}
              onSelect={() =>
                onSelectModel(row.original.model, row.original.provider)
              }
              className="flex-1"
            />
            <Badge variant="outline">{row.original.provider}</Badge>
          </div>
        ),
        size: 260,
      },
      {
        id: 'requests',
        header: () => (
          <div className="text-right">
            {t('usage.tables.topModels.requests')}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.requests)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'tokens',
        header: () => (
          <div className="text-right">{t('usage.tables.topModels.tokens')}</div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.tokens)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'cost',
        header: () => (
          <div className="text-right">{t('usage.tables.topModels.cost')}</div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatCostCents(row.original.costCents)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
    ],
    [t, formatNumber, formatCostCents, nameOf, onSelectModel],
  );

  return (
    <MetricsSection title={t('usage.tables.topModels.title')}>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => `${row.provider}::${row.model}`}
        isLoading={isLoading}
        approxRowCount={isLoading ? 5 : rows.length}
        onRowClick={handleRowClick}
        emptyState={{
          icon: BarChart3,
          title: t('usage.emptyModels.title'),
          description: t('usage.emptyModels.description'),
        }}
      />
    </MetricsSection>
  );
}
