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
  onSelectModel: (model: string) => void;
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
      onSelectModel(row.original.model);
    },
    [onSelectModel],
  );

  const columns = useMemo<ColumnDef<TopModelRow>[]>(
    () => [
      {
        id: 'model',
        header: t('usage.tables.topModels.model'),
        meta: { skeleton: { type: 'text-badge' } },
        cell: ({ row }) => (
          // The provider badge sits right after the name; a long model slug
          // truncates before the badge gives way.
          <div className="flex items-center gap-2">
            <DrilldownButton
              name={row.original.model}
              onSelect={() => onSelectModel(row.original.model)}
            />
            <Badge variant="outline" className="shrink-0">
              {row.original.provider}
            </Badge>
          </div>
        ),
        // The first column takes the slack; this is its floor, room for a
        // model slug beside its provider badge.
        size: 240,
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
        // A seven-digit count, "1,234,567", just wider than the header.
        size: 92,
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
        // A ten-digit count, "1,234,567,890".
        size: 120,
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
        // Five dollar digits in French, "12 345,67 $US".
        size: 120,
        meta: { align: 'right' as const },
      },
    ],
    [t, formatNumber, formatCostCents, onSelectModel],
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
