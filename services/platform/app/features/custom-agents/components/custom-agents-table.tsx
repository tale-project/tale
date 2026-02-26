'use client';

import type { Row } from '@tanstack/react-table';

import { useNavigate } from '@tanstack/react-router';
import { Bot } from 'lucide-react';
import { useMemo, useCallback } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { useT } from '@/lib/i18n/client';

import {
  useApproxCustomAgentCount,
  useListCustomAgentsPaginated,
  useModelPresets,
} from '../hooks/queries';
import { useCustomAgentsTableConfig } from '../hooks/use-custom-agents-table-config';
import { CustomAgentsActionMenu } from './custom-agents-action-menu';

export interface CustomAgentRow {
  _id: string;
  name: string;
  displayName: string;
  description?: string;
  systemInstructions: string;
  toolNames: string[];
  modelPreset: string;
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  maxSteps?: number;
  includeOrgKnowledge?: boolean;
  knowledgeTopK?: number;
  status: 'draft' | 'active' | 'archived';
  versionNumber: number;
  rootVersionId?: string;
  teamId?: string;
  sharedWithTeamIds?: string[];
  visibleInChat?: boolean;
  isSystemDefault?: boolean;
}

interface CustomAgentsTableProps {
  organizationId: string;
}

export function CustomAgentsTable({ organizationId }: CustomAgentsTableProps) {
  const { t: tEmpty } = useT('emptyStates');
  const { teams } = useTeamFilter();
  const navigate = useNavigate();
  const { data: count } = useApproxCustomAgentCount(organizationId);
  const { data: modelPresets } = useModelPresets();

  const teamNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (teams) {
      for (const team of teams) {
        map.set(team.id, team.name);
      }
    }
    return map;
  }, [teams]);

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useCustomAgentsTableConfig({ teamNameMap, modelPresets });
  const paginatedResult = useListCustomAgentsPaginated({
    organizationId,
    initialNumItems: pageSize,
  });

  const handleRowClick = useCallback(
    (row: Row<CustomAgentRow>) => {
      void navigate({
        to: '/dashboard/$id/custom-agents/$agentId',
        params: {
          id: organizationId,
          agentId: row.original.rootVersionId ?? row.original._id,
        },
      });
    },
    [navigate, organizationId],
  );

  const list = useListPage<CustomAgentRow>({
    dataSource: {
      type: 'paginated',
      results: paginatedResult.results,
      status: paginatedResult.status,
      loadMore: paginatedResult.loadMore,
      isLoading: paginatedResult.isLoading,
    },
    pageSize,
    search: {
      fields: ['displayName', 'name'],
      placeholder: searchPlaceholder,
    },
    approxRowCount: count,
  });

  return (
    <DataTable
      className="p-4"
      {...list.tableProps}
      columns={columns}
      stickyLayout={stickyLayout}
      onRowClick={handleRowClick}
      actionMenu={<CustomAgentsActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Bot,
        title: tEmpty('customAgents.title'),
        description: tEmpty('customAgents.description'),
      }}
    />
  );
}
