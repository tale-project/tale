'use client';

import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { Swords } from 'lucide-react';
import { useMemo } from 'react';

import { MetricsSection } from '@/app/components/metrics/metrics-section';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';

import type { FeedbackMatchupBucket } from './types';

interface TopMatchupsFeedbackTableProps {
  rows: FeedbackMatchupBucket[];
  isLoading: boolean;
}

export function TopMatchupsFeedbackTable({
  rows,
  isLoading,
}: TopMatchupsFeedbackTableProps) {
  const { t } = useT('analytics');
  const { formatNumber } = useFormatNumber();

  const columns = useMemo<ColumnDef<FeedbackMatchupBucket>[]>(
    () => [
      {
        id: 'matchup',
        header: t('feedback.tables.topMatchups.matchup'),
        cell: ({ row }) => (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            <Text as="span" variant="label" className="break-all">
              {row.original.modelLeft}
            </Text>
            <span className="text-muted-foreground shrink-0 text-xs">
              {t('feedback.tables.topMatchups.vs')}
            </span>
            <Text as="span" variant="label" className="break-all">
              {row.original.modelRight}
            </Text>
          </div>
        ),
        size: 420,
      },
      {
        id: 'score',
        header: () => (
          <div className="text-right">
            {t('feedback.tables.topMatchups.score')}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.leftWins)}
            <span className="text-muted-foreground mx-1">–</span>
            {formatNumber(row.original.rightWins)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'ties',
        header: () => (
          <div className="text-right">
            {t('feedback.tables.topMatchups.ties')}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.ties)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'bothBad',
        header: () => (
          <div className="text-right">
            {t('feedback.tables.topMatchups.bothBad')}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.bothBad)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'total',
        header: () => (
          <div className="text-right">
            {t('feedback.tables.topMatchups.total')}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.total)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
    ],
    [t, formatNumber],
  );

  return (
    <MetricsSection title={t('feedback.tables.topMatchups.title')}>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => `${row.modelLeft}::${row.modelRight}`}
        isLoading={isLoading}
        approxRowCount={isLoading ? 5 : rows.length}
        emptyState={{
          icon: Swords,
          title: t('feedback.tables.topMatchups.emptyTitle'),
          description: t('feedback.tables.topMatchups.emptyDescription'),
        }}
      />
    </MetricsSection>
  );
}
