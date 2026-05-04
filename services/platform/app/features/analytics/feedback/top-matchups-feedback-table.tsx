'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Swords } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';

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
  const { i18n: i18nCtx } = useTranslation();
  const locale = i18nCtx.language;

  const columns = useMemo<ColumnDef<FeedbackMatchupBucket>[]>(
    () => [
      {
        id: 'matchup',
        header: t('feedback.tables.topMatchups.matchup'),
        cell: ({ row }) => (
          <div className="flex max-w-[420px] items-center gap-2 text-sm">
            <Text as="span" variant="label" className="truncate">
              {row.original.modelLeft}
            </Text>
            <span className="text-muted-foreground text-xs">
              {t('feedback.tables.topMatchups.vs')}
            </span>
            <Text as="span" variant="label" className="truncate">
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
            {formatNumber(row.original.leftWins, locale)}
            <span className="text-muted-foreground mx-1">–</span>
            {formatNumber(row.original.rightWins, locale)}
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
            {formatNumber(row.original.ties, locale)}
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
            {formatNumber(row.original.bothBad, locale)}
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
            {formatNumber(row.original.total, locale)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
    ],
    [t, locale],
  );

  return (
    <div className="flex flex-col gap-3">
      <Text as="h3" className="text-foreground text-base font-semibold">
        {t('feedback.tables.topMatchups.title')}
      </Text>
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
    </div>
  );
}
