'use client';

import { useMemo, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Bot } from 'lucide-react';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { HStack } from '@/app/components/ui/layout/layout';
import { CustomAgentRowActions } from './custom-agent-row-actions';
import { CustomAgentsActionMenu } from './custom-agents-action-menu';
import { useT } from '@/lib/i18n/client';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { useListPage } from '@/app/hooks/use-list-page';

export interface CustomAgentRow {
  _id: string;
  name: string;
  displayName: string;
  description?: string;
  systemInstructions: string;
  toolNames: string[];
  modelPreset: string;
  temperature?: number;
  maxTokens?: number;
  maxSteps?: number;
  includeOrgKnowledge?: boolean;
  knowledgeTopK?: number;
  versionNumber: number;
  rootVersionId?: string;
  teamId?: string;
  sharedWithTeamIds?: string[];
}

interface CustomAgentTableProps {
  organizationId: string;
  agents: CustomAgentRow[] | null;
  isLoading: boolean;
}

export function CustomAgentTable({
  organizationId,
  agents,
  isLoading,
}: CustomAgentTableProps) {
  const { t } = useT('settings');
  const { teams } = useTeamFilter();
  const navigate = useNavigate();
  const modelPresets = useQuery(api.custom_agents.queries.getModelPresets);

  const handleRowClick = useCallback(
    (row: Row<CustomAgentRow>) => {
      navigate({
        to: '/dashboard/$id/custom-agents/$agentId',
        params: { id: organizationId, agentId: row.original.rootVersionId ?? row.original._id },
      });
    },
    [navigate, organizationId],
  );

  const teamNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (teams) {
      for (const team of teams) {
        map.set(team.id, team.name);
      }
    }
    return map;
  }, [teams]);

  const columns = useMemo<ColumnDef<CustomAgentRow>[]>(
    () => [
      {
        id: 'displayName',
        header: t('customAgents.columns.displayName'),
        cell: ({ row }) => (
          <span className="font-medium text-foreground">
            {row.original.displayName}
          </span>
        ),
        size: 250,
      },
      {
        id: 'modelPreset',
        header: t('customAgents.columns.modelPreset'),
        cell: ({ row }) => {
          const preset = row.original.modelPreset;
          const presetLabel = t(`customAgents.form.modelPresets.${preset}`);
          const modelName = modelPresets?.[preset as keyof typeof modelPresets];
          return (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {presetLabel}
              {modelName && (
                <span className="text-muted-foreground/60">{modelName}</span>
              )}
            </span>
          );
        },
        size: 200,
      },
      {
        id: 'tools',
        header: t('customAgents.columns.tools'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.toolNames.length}
          </span>
        ),
        size: 100,
      },
      {
        id: 'version',
        header: t('customAgents.columns.version'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            v{row.original.versionNumber}
          </span>
        ),
        size: 80,
      },
      {
        id: 'team',
        header: t('customAgents.columns.team'),
        cell: ({ row }) => {
          const { teamId: rowTeamId } = row.original;
          if (!rowTeamId) {
            return (
              <span className="text-xs text-muted-foreground">
                {t('customAgents.columns.orgWide')}
              </span>
            );
          }
          const teamName = teamNameMap.get(rowTeamId) ?? rowTeamId;
          return (
            <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
              {teamName}
            </span>
          );
        },
        size: 140,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <HStack gap={1} justify="end">
            <CustomAgentRowActions agent={row.original} />
          </HStack>
        ),
        size: 80,
      },
    ],
    [t, teamNameMap, modelPresets],
  );

  const list = useListPage({
    dataSource: { type: 'query', data: agents ?? undefined },
    pageSize: 25,
    search: {
      fields: ['displayName', 'name'],
      placeholder: t('customAgents.searchAgent'),
    },
  });

  return (
    <DataTable
      className="py-6 px-4"
      {...list.tableProps}
      columns={columns}
      onRowClick={handleRowClick}
      actionMenu={<CustomAgentsActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Bot,
        title: t('customAgents.noAgents'),
        description: t('customAgents.noAgentsDescription'),
      }}
      infiniteScroll={{
        ...list.tableProps.infiniteScroll,
        isInitialLoading: isLoading,
      }}
    />
  );
}
