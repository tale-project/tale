'use client';

import type { ColumnDef, Row } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Text } from '@/app/components/ui/typography/text';
import { useListAgents } from '@/app/features/agents/hooks/queries';
import { useT } from '@/lib/i18n/client';
import { formatCostCents, formatNumber } from '@/lib/utils/format/number';

export interface TopAgentRow {
  agentSlug: string | null;
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

  const displayNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (Array.isArray(agents)) {
      for (const a of agents) {
        if (
          a &&
          typeof a === 'object' &&
          'name' in a &&
          typeof (a as { name: unknown }).name === 'string'
        ) {
          const record = a as { name: string; displayName?: unknown };
          const name = record.name;
          const displayName =
            typeof record.displayName === 'string' ? record.displayName : name;
          map.set(name, displayName);
        }
      }
    }
    return map;
  }, [agents]);

  const resolveName = useCallback(
    (slug: string | null): string => {
      if (!slug) return t('usage.unknownAgent');
      return displayNameMap.get(slug) ?? slug;
    },
    [displayNameMap, t],
  );

  const handleRowClick = useCallback(
    (row: Row<TopAgentRow>) => {
      if (row.original.agentSlug) onSelectAgent(row.original.agentSlug);
    },
    [onSelectAgent],
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
    <div className="border-border flex flex-col gap-3 rounded-lg border px-5 py-4">
      <Text variant="label" as="h3" className="text-sm">
        {t('usage.tables.topAgents.title')}
      </Text>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.agentSlug ?? '__unknown__'}
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
