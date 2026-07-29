'use client';

import { Text } from '@tale/ui/text';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { MetricsSection } from '@/app/components/metrics/metrics-section';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';
import {
  isDirectApiSlug,
  isConnectorSlug,
  isSyntheticAgentSlug,
  isTranscriptionSlug,
  isTtsSlug,
} from '@/lib/shared/constants/usage';

export interface TopAgentRow {
  agentSlug: string;
  requests: number;
  tokens: number;
  costCents: number;
}

interface TopAgentsTableProps {
  rows: TopAgentRow[];
  isLoading: boolean;
  onSelectAgent: (agentSlug: string) => void;
}

export function TopAgentsTable({
  rows,
  isLoading,
  onSelectAgent,
}: TopAgentsTableProps) {
  const { t } = useT('analytics');
  const { formatNumber, formatCostCents } = useFormatNumber();

  const resolveName = useCallback(
    (slug: string): string => {
      if (isDirectApiSlug(slug)) return t('usage.directApi');
      if (isConnectorSlug(slug)) return t('usage.connector');
      if (isTranscriptionSlug(slug)) return t('usage.transcription');
      // Reached when a TTS row has no real assistant slug (thread without
      // an attached agent) and falls back to the `__tts__` sentinel.
      if (isTtsSlug(slug)) return t('usage.tts');
      // Localized display names came from the agent config catalog, which is
      // offline while the agents backend is rebuilt — real agent rows show
      // their raw slug until it returns.
      return slug;
    },
    [t],
  );

  const handleRowClick = useCallback(
    (row: Row<TopAgentRow>) => {
      const slug = row.original.agentSlug;
      if (!isSyntheticAgentSlug(slug)) onSelectAgent(slug);
    },
    [onSelectAgent],
  );

  // Suppress the pointer/hover affordance on synthetic rows — clicking them
  // is a no-op (no real agent to drill into), so the row should not look
  // clickable. tailwind-merge resolves cursor-default over the row-wide
  // cursor-pointer applied by DataTable when onRowClick is set.
  const rowClassName = useCallback(
    (row: Row<TopAgentRow>) =>
      isSyntheticAgentSlug(row.original.agentSlug)
        ? 'cursor-default hover:bg-transparent'
        : '',
    [],
  );

  const columns = useMemo<ColumnDef<TopAgentRow>[]>(
    () => [
      {
        id: 'agent',
        header: t('usage.tables.topAgents.agent'),
        cell: ({ row }) => (
          <Text
            as="span"
            variant="label"
            className="block max-w-[260px] truncate text-sm"
          >
            {resolveName(row.original.agentSlug)}
          </Text>
        ),
        size: 260,
      },
      {
        id: 'requests',
        header: () => (
          <div className="text-right">
            {t('usage.tables.topAgents.requests')}
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
          <div className="text-right">{t('usage.tables.topAgents.tokens')}</div>
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
          <div className="text-right">{t('usage.tables.topAgents.cost')}</div>
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatCostCents(row.original.costCents)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
    ],
    [t, resolveName, formatNumber, formatCostCents],
  );

  return (
    <MetricsSection title={t('usage.tables.topAgents.title')}>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.agentSlug}
        isLoading={isLoading}
        approxRowCount={isLoading ? 5 : rows.length}
        onRowClick={handleRowClick}
        rowClassName={rowClassName}
        emptyState={{
          icon: BarChart3,
          title: t('usage.empty.title'),
          description: t('usage.empty.description'),
        }}
      />
    </MetricsSection>
  );
}
