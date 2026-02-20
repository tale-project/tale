'use client';

import type { ColumnDef, Row } from '@tanstack/react-table';

import { useNavigate } from '@tanstack/react-router';
import { Bot } from 'lucide-react';
import { useMemo, useCallback } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Badge } from '@/app/components/ui/feedback/badge';
import { HStack } from '@/app/components/ui/layout/layout';
import { useListPage } from '@/app/hooks/use-list-page';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { useT } from '@/lib/i18n/client';
import { isKeyOf } from '@/lib/utils/type-guards';

import { useApproxCustomAgentCount, useModelPresets } from '../hooks/queries';
import { CustomAgentActiveToggle } from './custom-agent-active-toggle';
import { CustomAgentRowActions } from './custom-agent-row-actions';
import { CustomAgentsActionMenu } from './custom-agents-action-menu';

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
  status: 'draft' | 'active' | 'archived';
  versionNumber: number;
  rootVersionId?: string;
  teamId?: string;
  sharedWithTeamIds?: string[];
  isSystemDefault?: boolean;
}

interface CustomAgentTableProps {
  organizationId: string;
  agents: CustomAgentRow[] | undefined;
}

export function CustomAgentTable({
  organizationId,
  agents,
}: CustomAgentTableProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { t: tTables } = useT('tables');
  const { teams } = useTeamFilter();
  const navigate = useNavigate();
  const { data: count } = useApproxCustomAgentCount(organizationId);
  const { data: modelPresets } = useModelPresets();

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
          <span className="text-foreground font-medium">
            {row.original.displayName}
          </span>
        ),
        size: 250,
      },
      {
        id: 'status',
        header: tTables('headers.status'),
        cell: ({ row }) => {
          const { status } = row.original;
          return (
            <Badge dot variant={status === 'active' ? 'green' : 'outline'}>
              {status === 'active'
                ? tCommon('status.published')
                : status === 'archived'
                  ? tCommon('status.archived')
                  : tCommon('status.draft')}
            </Badge>
          );
        },
        size: 140,
      },
      {
        id: 'active',
        header: t('customAgents.columns.active'),
        size: 80,
        cell: ({ row }) => <CustomAgentActiveToggle agent={row.original} />,
      },
      {
        id: 'modelPreset',
        header: t('customAgents.columns.modelPreset'),
        cell: ({ row }) => {
          const preset = row.original.modelPreset;
          const presetLabel = t(`customAgents.form.modelPresets.${preset}`);
          const modelName =
            modelPresets && isKeyOf(preset, modelPresets)
              ? modelPresets[preset]
              : undefined;
          return (
            <Badge variant="outline">
              {presetLabel}
              {modelName && (
                <span className="text-muted-foreground/60 ml-1">
                  {modelName}
                </span>
              )}
            </Badge>
          );
        },
        size: 200,
      },
      {
        id: 'tools',
        header: t('customAgents.columns.tools'),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {row.original.toolNames.length}
          </span>
        ),
        size: 100,
      },
      {
        id: 'team',
        header: t('customAgents.columns.team'),
        cell: ({ row }) => {
          const { teamId: rowTeamId } = row.original;
          if (!rowTeamId) {
            return (
              <span className="text-muted-foreground text-xs">
                {t('customAgents.columns.orgWide')}
              </span>
            );
          }
          const teamName = teamNameMap.get(rowTeamId) ?? rowTeamId;
          return <Badge variant="blue">{teamName}</Badge>;
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
    [t, tCommon, tTables, teamNameMap, modelPresets],
  );

  const list = useListPage({
    dataSource: { type: 'query', data: agents },
    pageSize: 25,
    search: {
      fields: ['displayName', 'name'],
      placeholder: t('customAgents.searchAgent'),
    },
    skeletonRows: Math.min(count ?? 10, 10),
  });

  return (
    <DataTable
      className="px-4 py-6"
      {...list.tableProps}
      columns={columns}
      onRowClick={handleRowClick}
      actionMenu={<CustomAgentsActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Bot,
        title: t('customAgents.noAgents'),
        description: t('customAgents.noAgentsDescription'),
      }}
    />
  );
}
