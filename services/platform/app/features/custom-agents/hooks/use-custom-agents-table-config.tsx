'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { isKeyOf } from '@/lib/utils/type-guards';

import type { CustomAgentRow } from '../components/custom-agents-table';

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
  modelPresets,
}: CustomAgentsTableConfigOptions): CustomAgentsTableConfig {
  const { t } = useT('settings');

  const columns = useMemo<ColumnDef<CustomAgentRow>[]>(
    () => [
      {
        id: 'displayName',
        header: t('customAgents.columns.displayName'),
        meta: { hasAvatar: false },
        cell: ({ row }) => (
          <Text as="span" variant="label">
            {row.original.displayName}
          </Text>
        ),
        size: 250,
      },
      {
        id: 'modelPreset',
        header: t('customAgents.columns.modelPreset'),
        meta: { skeleton: { type: 'badge' } },
        cell: ({ row }) => {
          const preset = row.original.modelPreset ?? 'standard';
          const presetLabel = t(`customAgents.form.modelPresets.${preset}`);
          const modelName =
            modelPresets && isKeyOf(preset, modelPresets)
              ? modelPresets[preset]?.[0]
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
        header: () => (
          <span className="block w-full text-right">
            {t('customAgents.columns.tools')}
          </span>
        ),
        size: 100,
        meta: { headerLabel: t('customAgents.columns.tools'), align: 'right' },
        cell: ({ row }) => (
          <Text as="span" variant="muted" className="block text-right">
            {row.original.toolNames?.length ?? 0}
          </Text>
        ),
      },
      {
        id: 'actions',
        header: '',
        meta: { isAction: true },
        cell: ({ row }) => (
          <HStack gap={1} justify="end">
            <CustomAgentRowActions
              agentName={row.original.name}
              displayName={row.original.displayName}
            />
          </HStack>
        ),
        size: 80,
      },
    ],
    [t, modelPresets],
  );

  return {
    columns,
    searchPlaceholder: t('customAgents.searchAgent'),
    stickyLayout: false,
    pageSize: 50,
  };
}
