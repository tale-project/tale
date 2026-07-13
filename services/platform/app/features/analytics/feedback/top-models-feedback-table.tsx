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

import type { FeedbackModelBucket } from './types';

interface TopModelsFeedbackTableProps {
  rows: FeedbackModelBucket[];
  isLoading: boolean;
  onSelectModel: (model: string, provider: string) => void;
}

export function TopModelsFeedbackTable({
  rows,
  isLoading,
  onSelectModel,
}: TopModelsFeedbackTableProps) {
  const { t } = useT('analytics');
  const { formatNumber, formatPercentShare } = useFormatNumber();

  const handleRowClick = useCallback(
    (row: Row<FeedbackModelBucket>) => {
      onSelectModel(row.original.model, row.original.provider);
    },
    [onSelectModel],
  );

  const columns = useMemo<ColumnDef<FeedbackModelBucket>[]>(
    () => [
      {
        id: 'model',
        header: t('feedback.tables.topModels.model'),
        cell: ({ row }) => (
          <div className="flex items-baseline gap-2">
            <Text as="span" variant="label" className="text-sm break-all">
              {row.original.model}
            </Text>
            <Badge variant="outline" className="shrink-0">
              {row.original.provider}
            </Badge>
          </div>
        ),
        size: 260,
      },
      {
        id: 'helpful',
        header: () => (
          <div className="text-right">
            {t('feedback.tables.topModels.helpful')}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.positive)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'notHelpful',
        header: () => (
          <div className="text-right">
            {t('feedback.tables.topModels.notHelpful')}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.negative)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'sentiment',
        header: () => (
          <div className="text-right">
            {t('feedback.tables.topModels.sentiment')}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatPercentShare(row.original.positive, row.original.total)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
    ],
    [t, formatNumber, formatPercentShare],
  );

  return (
    <MetricsSection title={t('feedback.tables.topModels.title')}>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => `${row.provider}::${row.model}`}
        isLoading={isLoading}
        approxRowCount={isLoading ? 5 : rows.length}
        onRowClick={handleRowClick}
        emptyState={{
          icon: BarChart3,
          title: t('feedback.tables.topModels.emptyTitle'),
          description: t('feedback.tables.topModels.emptyDescription'),
        }}
      />
    </MetricsSection>
  );
}
