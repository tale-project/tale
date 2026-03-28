'use client';

import type { Row } from '@tanstack/react-table';

import { useNavigate } from '@tanstack/react-router';
import { useAction } from 'convex/react';
import { Bot } from 'lucide-react';
import { useMemo, useCallback, useEffect, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useModelPresets } from '../hooks/queries';
import { useAgentsTableConfig } from '../hooks/use-agents-table-config';
import { AgentsActionMenu } from './agents-action-menu';

export interface AgentRow {
  name: string;
  displayName: string;
  description?: string;
  modelPreset?: string;
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
  const { data: modelPresets } = useModelPresets();
  const listAgents = useAction(api.agents.file_actions.listAgents);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadAgents = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await listAgents({ orgSlug: 'default' });
      const validAgents: AgentRow[] = [];
      for (const a of result ?? []) {
        if (a && 'displayName' in a && typeof a.displayName === 'string') {
          validAgents.push({
            name: a.name,
            displayName: a.displayName,
            description: a.description,
            modelPreset: a.modelPreset,
            toolNames: a.toolNames,
            visibleInChat: a.visibleInChat,
            roleRestriction: a.roleRestriction,
          });
        }
      }
      setAgents(validAgents);
    } catch (err) {
      console.error('Failed to load agents:', err);
    } finally {
      setIsLoading(false);
    }
  }, [listAgents]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

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
      modelPresets,
      onDuplicated: loadAgents,
      onDeleted: loadAgents,
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
