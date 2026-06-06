'use client';

import { Badge } from '@tale/ui/badge';
import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import {
  ACTIONS_COLUMN_SIZE,
  createSelectColumn,
} from '@/app/components/ui/data-table/column-builders';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import { useT } from '@/lib/i18n/client';
import { stripModelRefQualifier } from '@/lib/shared/utils/model-ref';

import { AgentRowActions } from '../components/agent-row-actions';
import type { AgentRow } from '../components/agents-table';

interface AgentsTableConfig {
  columns: ColumnDef<AgentRow>[];
  searchPlaceholder: string;
  stickyLayout: boolean;
  pageSize: number;
}

interface AgentsTableConfigOptions {
  organizationId: string;
  teamNameMap: Map<string, string>;
  onDuplicated?: (newAgentName: string) => void;
  onDeleted?: () => void;
}

export function useAgentsTableConfig({
  organizationId,
  onDuplicated,
  onDeleted,
}: AgentsTableConfigOptions): AgentsTableConfig {
  const { t } = useT('settings');

  const columns = useMemo<ColumnDef<AgentRow>[]>(
    () => [
      // Multi-row select — canonical 40px column matching every other entity
      // table. The container gates `enableRowSelection` to non-protected agents
      // so the built-in agents can't be bulk-deleted.
      createSelectColumn<AgentRow>(),
      {
        id: 'displayName',
        header: t('agents.columns.displayName'),
        meta: { hasAvatar: false },
        cell: ({ row }) => (
          <Text as="span" variant="label">
            {row.original.displayName}
          </Text>
        ),
        size: 250,
      },
      {
        id: 'model',
        header: t('agents.columns.model'),
        meta: { skeleton: { type: 'badge' } },
        cell: ({ row }) => {
          const model = row.original.supportedModels?.[0];
          if (!model) return null;
          return (
            <Badge variant="outline">{stripModelRefQualifier(model)}</Badge>
          );
        },
        size: 200,
      },
      {
        id: 'tools',
        header: () => (
          <span className="block w-full text-right">
            {t('agents.columns.tools')}
          </span>
        ),
        size: 100,
        meta: { headerLabel: t('agents.columns.tools'), align: 'right' },
        cell: ({ row }) => (
          <Text as="span" variant="muted" className="block text-right">
            {row.original.toolNames?.length ?? 0}
          </Text>
        ),
      },
      {
        id: 'actions',
        header: '',
        // Locked to `ACTIONS_COLUMN_SIZE` so the 3-dot column aligns with
        // every other table's actions column.
        size: ACTIONS_COLUMN_SIZE,
        meta: { isAction: true },
        cell: ({ row }) => (
          <HStack gap={1} justify="end">
            <AgentRowActions
              agentName={row.original.name}
              organizationId={organizationId}
              onDuplicated={onDuplicated}
              onDeleted={onDeleted}
            />
          </HStack>
        ),
      },
    ],
    [t, organizationId, onDuplicated, onDeleted],
  );

  return {
    columns,
    searchPlaceholder: t('agents.searchAgent'),
    stickyLayout: false,
    // Aligned to the shared default (was 50) so every entity table paginates
    // consistently. Agents lists are short enough that 20-per-page rarely
    // requires a "load more" click anyway.
    pageSize: DEFAULT_TABLE_PAGE_SIZE,
  };
}
