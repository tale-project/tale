'use client';

import type { Row } from '@tanstack/react-table';

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Bot } from 'lucide-react';
import { useMemo, useCallback } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { useT } from '@/lib/i18n/client';

import { useListAgents } from '../hooks/queries';
import { useAgentsTableConfig } from '../hooks/use-agents-table-config';
import { AgentsActionMenu } from './agents-action-menu';

export interface AgentRow {
  name: string;
  displayName: string;
  description?: string;
  supportedModels?: string[];
  toolNames?: string[];
  visibleInChat?: boolean;
  roleRestriction?: string;
  status?: string;
  message?: string;
}

interface AgentsTableProps {
  organizationId: string;
}

export function AgentsTable({ organizationId }: AgentsTableProps) {
  const { t: tEmpty } = useT('emptyStates');
  const { teams } = useTeamFilter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { agents: rawAgents, isLoading } = useListAgents('default');

  const agents = useMemo(() => {
    if (!rawAgents) return [];
    const validAgents: AgentRow[] = [];
    for (const a of rawAgents) {
      if (a && 'displayName' in a && typeof a.displayName === 'string') {
        validAgents.push({
          name: a.name,
          displayName: a.displayName,
          description: a.description,
          supportedModels: a.supportedModels,
          toolNames: a.toolNames,
          visibleInChat: a.visibleInChat,
          roleRestriction: a.roleRestriction,
        });
      }
    }
    return validAgents;
  }, [rawAgents]);

  const invalidateAgents = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['config', 'agents'] });
  }, [queryClient]);

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
    useAgentsTableConfig({
      teamNameMap,
      onDuplicated: invalidateAgents,
      onDeleted: invalidateAgents,
    });

  const handleRowClick = useCallback(
    (row: Row<AgentRow>) => {
      void navigate({
        to: '/dashboard/$id/agents/$agentId',
        params: {
          id: organizationId,
          agentId: row.original.name,
        },
      });
    },
    [navigate, organizationId],
  );

  const list = useListPage<AgentRow>({
    dataSource: {
      type: 'query',
      data: isLoading ? undefined : agents,
    },
    pageSize,
    search: {
      fields: ['displayName', 'name'],
      placeholder: searchPlaceholder,
    },
  });

  return (
    <DataTable
      className="p-4"
      {...list.tableProps}
      columns={columns}
      stickyLayout={stickyLayout}
      onRowClick={handleRowClick}
      actionMenu={<AgentsActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Bot,
        title: tEmpty('agents.title'),
        description: tEmpty('agents.description'),
      }}
    />
  );
}
