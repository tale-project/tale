'use client';

import type { ColumnDef, Row } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { formatCostCents, formatNumber } from '@/lib/utils/format/number';

export interface TopModelRow {
  provider: string | null;
  model: string | null;
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

  const handleRowClick = useCallback(
    (row: Row<TopModelRow>) => {
      if (row.original.model) onSelectModel(row.original.model);
    },
    [onSelectModel],
  );

  const columns = useMemo<ColumnDef<TopModelRow>[]>(
    () => [
      {
        id: 'model',
        header: t('usage.tables.topModels.model'),
        cell: ({ row }) => (
          <div className="flex max-w-[260px] items-center gap-2">
            <Text
              as="span"
              variant="label"
              className="block flex-1 truncate text-sm"
            >
              {row.original.model ?? t('usage.unknownModel')}
            </Text>
            {row.original.provider ? (
              <Badge variant="outline">{row.original.provider}</Badge>
            ) : null}
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
    [t],
  );

  return (
    <div className="flex flex-col gap-3">
      <Text as="h3" className="text-foreground text-base font-semibold">
        {t('usage.tables.topModels.title')}
      </Text>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) =>
          `${row.provider ?? '_'}::${row.model ?? '__unknown__'}`
        }
        isLoading={isLoading}
        approxRowCount={isLoading ? 5 : rows.length}
        onRowClick={handleRowClick}
        emptyState={{
          icon: BarChart3,
          title: t('usage.empty.title'),
          description: t('usage.empty.description'),
        }}
      />
    </div>
  );
}
