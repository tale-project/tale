'use client';

import { DataTable } from '@tale/ui/data-table/data-table';
import { MetricsSection } from '@tale/ui/metrics/metrics-section';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useMemo } from 'react';

import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';
import { isAutomationSubject } from '@/lib/shared/constants/usage';

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

  // Column sizes double as the table's min-width floor (DataTable sums them):
  // 644px, inside the settings content column down to a 1024px window. The
  // numbers hold their widest value at their declared px; the user column
  // takes the rest.
  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      {
        id: 'user',
        header: t('usage.tables.users.user'),
        cell: ({ row }) => (
          <Text as="span" variant="label" className="block truncate text-sm">
            {isAutomationSubject(row.original.userId)
              ? t('usage.tables.users.automations')
              : row.original.displayName}
          </Text>
        ),
        // The first column takes the slack; this is its floor.
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
        // The German header "Eingabe-Tokens", wider than a ten-digit count.
        size: 132,
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
        // The German header "Ausgabe-Tokens", wider than a ten-digit count.
        size: 140,
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
        // Five dollar digits in French, "12 345,67 $US".
        size: 120,
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
        // A seven-digit count, "1,234,567", just wider than the header.
        size: 92,
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
      <Text as="p" variant="muted">
        {t('usage.tables.users.note')}
      </Text>
    </MetricsSection>
  );
}
