'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { Row } from '@tanstack/react-table';
import { Bot } from 'lucide-react';
import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { useT } from '@/lib/i18n/client';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';

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
  const { t: tSettings } = useT('settings');
  const { teams } = useTeamFilter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { agents: rawAgents, isLoading } = useListAgents(organizationId);
  const { i18n: i18nCtx } = useTranslation();
  const locale = i18nCtx.language;

  const agents = useMemo(() => {
    if (!rawAgents) return [];
    const validAgents: AgentRow[] = [];
    for (const a of rawAgents) {
      // Skip read errors surfaced by listAgents (they have `status`/`message`
      // instead of config fields).
      if (!a || typeof a.name !== 'string' || 'status' in a) continue;
      const resolved = resolveAgentLocale(a, locale);
      if (!resolved.displayName) continue;
      validAgents.push({
        name: a.name,
        displayName: resolved.displayName,
        description: resolved.description,
        supportedModels: a.supportedModels,
        toolNames: a.toolNames,
        visibleInChat: a.visibleInChat,
        roleRestriction: a.roleRestriction,
      });
    }
    return validAgents;
  }, [rawAgents, locale]);

  const invalidateAgents = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['config', 'agents'] });
  }, [queryClient]);

  // Briefly highlight a freshly-duplicated row so it reads as a new, separate
  // agent in the list rather than something tied to the menu it came from
  // (#1354).
  const [highlightedName, setHighlightedName] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

  const handleDuplicated = useCallback(
    (newAgentName: string) => {
      invalidateAgents();
      setHighlightedName(newAgentName);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlightedName(null), 2500);
    },
    [invalidateAgents],
  );

  const teamNameMap = useMemo(() => {
    const map = new Map();
    if (teams) {
      for (const team of teams) {
        map.set(team.id, team.name);
      }
    }
    return map;
  }, [teams]);

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useAgentsTableConfig({
      organizationId,
      teamNameMap,
      onDuplicated: handleDuplicated,
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
    entityLabel: tSettings('agents.entityLabel'),
  });

  return (
    <DataTable
      className="p-4"
      {...list.tableProps}
      columns={columns}
      stickyLayout={stickyLayout}
      rowClassName={(row) =>
        row.original.name === highlightedName
          ? 'bg-primary/10 transition-colors duration-500 motion-reduce:transition-none'
          : ''
      }
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
