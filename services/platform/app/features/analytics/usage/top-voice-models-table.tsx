'use client';

import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { MetricsSection } from '@/app/components/metrics/metrics-section';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';

export interface TopVoiceModelRow {
  provider: string;
  model: string;
  requests: number;
  characters: number;
  costCents: number;
}

interface TopVoiceModelsTableProps {
  rows: TopVoiceModelRow[];
  isLoading: boolean;
  onSelectModel: (model: string) => void;
}

export function TopVoiceModelsTable({
  rows,
  isLoading,
  onSelectModel,
}: TopVoiceModelsTableProps) {
  const { t } = useT('analytics');
  const { formatNumber, formatCostCents } = useFormatNumber();

  const handleRowClick = useCallback(
    (row: Row<TopVoiceModelRow>) => {
      onSelectModel(row.original.model);
    },
    [onSelectModel],
  );

  const columns = useMemo<ColumnDef<TopVoiceModelRow>[]>(
    () => [
      {
        id: 'model',
        header: t('usage.tables.topVoiceModels.model'),
        cell: ({ row }) => (
          <div className="flex max-w-[260px] items-center gap-2">
            <Text
              as="span"
              variant="label"
              className="block flex-1 truncate text-sm"
            >
              {row.original.model}
            </Text>
            <Badge variant="outline">{row.original.provider}</Badge>
          </div>
        ),
        size: 260,
      },
      {
        id: 'requests',
        header: () => (
          <div className="text-right">
            {t('usage.tables.topVoiceModels.requests')}
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
        id: 'characters',
        header: () => (
          <div className="text-right">
            {t('usage.tables.topVoiceModels.characters')}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.characters)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'cost',
        header: () => (
          <div className="text-right">
            {t('usage.tables.topVoiceModels.cost')}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatCostCents(row.original.costCents)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
    ],
    [t, formatNumber, formatCostCents],
  );

  return (
    <MetricsSection title={t('usage.tables.topVoiceModels.title')}>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => `${row.provider}::${row.model}`}
        isLoading={isLoading}
        approxRowCount={isLoading ? 5 : rows.length}
        onRowClick={handleRowClick}
        emptyState={{
          icon: BarChart3,
          title: t('usage.emptyVoiceModels.title'),
          description: t('usage.emptyVoiceModels.description'),
        }}
      />
    </MetricsSection>
  );
}
