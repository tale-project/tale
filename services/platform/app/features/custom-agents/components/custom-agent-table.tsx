'use client';

import { useMemo } from 'react';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { HStack } from '@/app/components/ui/layout/layout';
import { CustomAgentRowActions } from './custom-agent-row-actions';
import { Bot } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { useT } from '@/lib/i18n/client';
import { useTeamFilter } from '@/app/hooks/use-team-filter';

interface CustomAgentRow {
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
  includeKnowledge: boolean;
  knowledgeTopK?: number;
  currentVersion: number;
  teamId?: string;
  sharedWithTeamIds?: string[];
}

interface CustomAgentTableProps {
  agents: CustomAgentRow[];
  isLoading: boolean;
}

export function CustomAgentTable({
  agents,
  isLoading,
}: CustomAgentTableProps) {
  const { t } = useT('settings');
  const { teams } = useTeamFilter();

  const teamNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (teams) {
      for (const team of teams) {
        map.set(team.id, team.name);
      }
    }
    return map;
  }, [teams]);

  const columns = useMemo<ColumnDef<CustomAgentRow>[]>(() => [
    {
      id: 'displayName',
      header: t('customAgents.columns.displayName'),
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.displayName}</span>
      ),
      size: 250,
    },
    {
      id: 'modelPreset',
      header: t('customAgents.columns.modelPreset'),
      cell: ({ row }) => (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {t(`customAgents.form.modelPresets.${row.original.modelPreset}`)}
        </span>
      ),
      size: 120,
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
          v{row.original.currentVersion}
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
  ], [t, teamNameMap]);

  if (isLoading) {
    return null;
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Bot className="size-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium text-foreground">
          {t('customAgents.noAgents')}
        </h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          {t('customAgents.noAgentsDescription')}
        </p>
      </div>
    );
  }

  return (
    <DataTable columns={columns} data={agents} getRowId={(row) => row._id} />
  );
}
