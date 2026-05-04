'use client';

import type { ColumnDef, Row } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';

import type { FeedbackModelBucket } from './types';

interface TopModelsFeedbackTableProps {
  rows: FeedbackModelBucket[];
  isLoading: boolean;
  onSelectModel: (model: string, provider: string) => void;
}

function formatPercent(
  positive: number,
  total: number,
  locale: string,
): string {
  if (total === 0) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(positive / total);
  } catch {
    return `${Math.round((positive / total) * 100)}%`;
  }
}

export function TopModelsFeedbackTable({
  rows,
  isLoading,
  onSelectModel,
}: TopModelsFeedbackTableProps) {
  const { t } = useT('analytics');
  const { i18n: i18nCtx } = useTranslation();
  const locale = i18nCtx.language;

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
        id: 'helpful',
        header: () => (
          <div className="text-right">
            {t('feedback.tables.topModels.helpful')}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.positive, locale)}
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
            {formatNumber(row.original.negative, locale)}
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
            {formatPercent(row.original.positive, row.original.total, locale)}
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
        {t('feedback.tables.topModels.title')}
      </Text>
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
    </div>
  );
}
