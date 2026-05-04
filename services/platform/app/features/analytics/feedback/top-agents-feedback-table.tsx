'use client';

import type { ColumnDef, Row } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Text } from '@/app/components/ui/typography/text';
import { useListAgents } from '@/app/features/agents/hooks/queries';
import { useT } from '@/lib/i18n/client';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';
import { formatNumber } from '@/lib/utils/format/number';

import { UNATTRIBUTED_AGENT_SLUG, type FeedbackAgentBucket } from './types';

interface TopAgentsFeedbackTableProps {
  rows: FeedbackAgentBucket[];
  isLoading: boolean;
  onSelectAgent: (agentSlug: string) => void;
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

export function TopAgentsFeedbackTable({
  rows,
  isLoading,
  onSelectAgent,
}: TopAgentsFeedbackTableProps) {
  const { t } = useT('analytics');
  const { agents } = useListAgents('default');
  const { i18n: i18nCtx } = useTranslation();
  const locale = i18nCtx.language;

  const displayNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (Array.isArray(agents)) {
      for (const a of agents) {
        if (
          a &&
          typeof a === 'object' &&
          'name' in a &&
          typeof (a as { name: unknown }).name === 'string' &&
          !('status' in a)
        ) {
          const name = (a as { name: string }).name;
          const resolved = resolveAgentLocale(a, locale);
          map.set(name, resolved.displayName || name);
        }
      }
    }
    return map;
  }, [agents, locale]);

  const resolveName = useCallback(
    (slug: string): string => {
      if (slug === UNATTRIBUTED_AGENT_SLUG) {
        return t('feedback.tables.topAgents.unattributed');
      }
      return displayNameMap.get(slug) ?? slug;
    },
    [displayNameMap, t],
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
            {formatNumber(row.original.positive, locale)}
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
            {formatNumber(row.original.negative, locale)}
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
            {formatPercent(row.original.positive, row.original.total, locale)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
    ],
    [t, resolveName, locale],
  );

  return (
    <div className="flex flex-col gap-3">
      <Text as="h3" className="text-foreground text-base font-semibold">
        {t('feedback.tables.topAgents.title')}
      </Text>
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
    </div>
  );
}
