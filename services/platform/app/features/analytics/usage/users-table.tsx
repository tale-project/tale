'use client';

import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useMemo } from 'react';

import { MetricsSection } from '@/app/components/metrics/metrics-section';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';

export interface UserRow {
  userId: string;
  displayName: string;
  teamId: string | null;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  costCents: number;
  requests: number;
}

interface UsersTableProps {
  rows: UserRow[];
  isLoading: boolean;
}

export function UsersTable({ rows, isLoading }: UsersTableProps) {
  const { t } = useT('analytics');
  const { formatNumber, formatCostCents } = useFormatNumber();

  // Column sizes double as the table's min-width floor (DataTable sums them).
  // Keep the total ≤ 940px so the table fits the settings content column on
  // common laptop widths instead of clipping behind a horizontal scroll.
  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        id: 'user',
        header: t('usage.tables.users.user'),
        cell: ({ row }) => (
          <Text
            as="span"
            variant="label"
            className="block max-w-[220px] truncate text-sm"
          >
            {row.original.displayName}
          </Text>
        ),
        size: 220,
      },
      {
        id: 'team',
        header: t('usage.tables.users.team'),
        cell: ({ row }) => (
          <Text as="span" variant="caption">
            {row.original.teamId ?? '\u2014'}
          </Text>
        ),
        size: 160,
      },
      {
        id: 'inputTokens',
        header: () => (
          <div className="text-right">
            {t('usage.tables.users.inputTokens')}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.inputTokens)}
          </div>
        ),
        meta: { align: 'right' as const },
        size: 130,
      },
      {
        id: 'outputTokens',
        header: () => (
          <div className="text-right">
            {t('usage.tables.users.outputTokens')}
          </div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.outputTokens)}
          </div>
        ),
        meta: { align: 'right' as const },
        size: 130,
      },
      {
        id: 'cost',
        header: () => (
          <div className="text-right">{t('usage.tables.users.cost')}</div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatCostCents(row.original.costCents)}
          </div>
        ),
        meta: { align: 'right' as const },
        size: 130,
      },
      {
        id: 'requests',
        header: () => (
          <div className="text-right">{t('usage.tables.users.requests')}</div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.requests)}
          </div>
        ),
        meta: { align: 'right' as const },
        size: 130,
      },
    ],
    [t, formatNumber, formatCostCents],
  );

  return (
    <MetricsSection title={t('usage.tables.users.title')}>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => `${row.userId}-${row.teamId ?? ''}`}
        isLoading={isLoading}
        approxRowCount={isLoading ? 5 : rows.length}
        emptyState={{
          icon: BarChart3,
          title: t('usage.empty.title'),
          description: t('usage.empty.description'),
        }}
      />
    </MetricsSection>
  );
}
