'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { isKeyOf } from '@/lib/utils/type-guards';

import type { CustomAgentRow } from '../components/custom-agents-table';

import { CustomAgentActiveToggle } from '../components/custom-agent-active-toggle';
import { CustomAgentRowActions } from '../components/custom-agent-row-actions';

interface CustomAgentsTableConfig {
  columns: ColumnDef<CustomAgentRow>[];
  searchPlaceholder: string;
  stickyLayout: boolean;
  pageSize: number;
}

interface CustomAgentsTableConfigOptions {
  teamNameMap: Map<string, string>;
  modelPresets: Record<string, string[]> | undefined;
}

export function useCustomAgentsTableConfig({
  teamNameMap,
  modelPresets,
}: CustomAgentsTableConfigOptions): CustomAgentsTableConfig {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { t: tTables } = useT('tables');

  const columns = useMemo<ColumnDef<CustomAgentRow>[]>(
    () => [
      {
        id: 'displayName',
        header: t('customAgents.columns.displayName'),
        cell: ({ row }) => (
          <Text as="span" variant="label">
            {row.original.displayName}
          </Text>
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
            row.original.modelId ??
            (modelPresets && isKeyOf(preset, modelPresets)
              ? modelPresets[preset]?.[0]
              : undefined);
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
          <Text as="span" variant="muted">
            {row.original.toolNames.length}
          </Text>
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
              <Text as="span" variant="caption">
                {t('customAgents.columns.orgWide')}
              </Text>
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
        meta: { isAction: true },
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

  return {
    columns,
    searchPlaceholder: t('customAgents.searchAgent'),
    stickyLayout: false,
    pageSize: 25,
  };
}
