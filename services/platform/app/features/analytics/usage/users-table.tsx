'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useMemo } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { formatCostCents, formatNumber } from '@/lib/utils/format/number';

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
      },
    ],
    [t],
  );

  return (
    <div className="border-border flex flex-col gap-3 rounded-lg border px-5 py-4">
      <Text variant="label" as="h3" className="text-sm">
        {t('usage.tables.users.title')}
      </Text>
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
    </div>
  );
}
