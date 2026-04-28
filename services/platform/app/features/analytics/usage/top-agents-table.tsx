'use client';

import type { ColumnDef, Row } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Text } from '@/app/components/ui/typography/text';
import { useListAgents } from '@/app/features/agents/hooks/queries';
import { useT } from '@/lib/i18n/client';
import {
  isDirectApiSlug,
  isIntegrationSlug,
  isSyntheticAgentSlug,
  isTranscriptionSlug,
} from '@/lib/shared/constants/usage';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';
import { formatCostCents, formatNumber } from '@/lib/utils/format/number';

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
      if (isDirectApiSlug(slug)) return t('usage.directApi');
      if (isIntegrationSlug(slug)) return t('usage.integration');
      if (isTranscriptionSlug(slug)) return t('usage.transcription');
      return displayNameMap.get(slug) ?? slug;
    },
    [displayNameMap, t],
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
    [t, resolveName],
  );

  return (
    <div className="flex flex-col gap-3">
      <Text as="h3" className="text-foreground text-base font-semibold">
        {t('usage.tables.topAgents.title')}
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
          title: t('usage.empty.title'),
          description: t('usage.empty.description'),
        }}
      />
    </div>
  );
}
