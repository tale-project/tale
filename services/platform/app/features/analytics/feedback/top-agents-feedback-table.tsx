'use client';

import { Text } from '@tale/ui/text';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { MetricsSection } from '@/app/components/metrics/metrics-section';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useT } from '@/lib/i18n/client';

import { UNATTRIBUTED_AGENT_SLUG, type FeedbackAgentBucket } from './types';

interface TopAgentsFeedbackTableProps {
  rows: FeedbackAgentBucket[];
  isLoading: boolean;
  onSelectAgent: (agentSlug: string) => void;
}

export function TopAgentsFeedbackTable({
  rows,
  isLoading,
  onSelectAgent,
}: TopAgentsFeedbackTableProps) {
  const { t } = useT('analytics');
  const { formatNumber, formatPercentShare } = useFormatNumber();

  const resolveName = useCallback(
    (slug: string): string => {
      if (slug === UNATTRIBUTED_AGENT_SLUG) {
        return t('feedback.tables.topAgents.unattributed');
      }
      // Localized display names came from the agent config catalog, which is
      // offline while the agents backend is rebuilt — agent rows show their
      // raw slug until it returns.
      return slug;
    },
    [t],
  );

  const handleRowClick = useCallback(
    (row: Row<FeedbackAgentBucket>) => {
      const slug = row.original.agentSlug;
      if (slug === UNATTRIBUTED_AGENT_SLUG) return;
      onSelectAgent(slug);
    },
    [onSelectAgent],
  );

  const rowClassName = useCallback(
    (row: Row<FeedbackAgentBucket>) =>
      row.original.agentSlug === UNATTRIBUTED_AGENT_SLUG
        ? 'cursor-default hover:bg-transparent'
        : '',
    [],
  );

  const columns = useMemo<ColumnDef<FeedbackAgentBucket>[]>(
    () => [
      {
        id: 'agent',
        header: t('feedback.tables.topAgents.agent'),
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
        id: 'helpful',
        header: () => (
          <div className="text-right">
            {t('feedback.tables.topAgents.helpful')}
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
            {t('feedback.tables.topAgents.notHelpful')}
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
            {t('feedback.tables.topAgents.sentiment')}
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
    [t, resolveName, formatNumber, formatPercentShare],
  );

  return (
    <MetricsSection title={t('feedback.tables.topAgents.title')}>
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
          title: t('feedback.tables.topAgents.emptyTitle'),
          description: t('feedback.tables.topAgents.emptyDescription'),
        }}
      />
    </MetricsSection>
  );
}
