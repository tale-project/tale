'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { isKeyOf } from '@/lib/utils/type-guards';

import type { AgentRow } from '../components/agents-table';

import { AgentRowActions } from '../components/agent-row-actions';

interface AgentsTableConfig {
  columns: ColumnDef<AgentRow>[];
  searchPlaceholder: string;
  stickyLayout: boolean;
  pageSize: number;
}

interface AgentsTableConfigOptions {
  teamNameMap: Map<string, string>;
  modelPresets: Record<string, string[]> | undefined;
  onDuplicated?: () => void;
  onDeleted?: () => void;
}

export function useAgentsTableConfig({
  modelPresets,
  onDuplicated,
  onDeleted,
}: AgentsTableConfigOptions): AgentsTableConfig {
  const { t } = useT('settings');

  const columns = useMemo<ColumnDef<AgentRow>[]>(
    () => [
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
        id: 'modelPreset',
        header: t('agents.columns.modelPreset'),
        meta: { skeleton: { type: 'badge' } },
        cell: ({ row }) => {
          const preset = row.original.modelPreset ?? 'standard';
          const presetLabel = t(`agents.form.modelPresets.${preset}`);
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
        meta: { isAction: true },
        cell: ({ row }) => (
          <HStack gap={1} justify="end">
            <AgentRowActions
              agentName={row.original.name}
              onDuplicated={onDuplicated}
              onDeleted={onDeleted}
            />
          </HStack>
        ),
        size: 80,
      },
    ],
    [t, modelPresets, onDuplicated, onDeleted],
  );

  return {
    columns,
    searchPlaceholder: t('agents.searchAgent'),
    stickyLayout: false,
    pageSize: 50,
  };
}
