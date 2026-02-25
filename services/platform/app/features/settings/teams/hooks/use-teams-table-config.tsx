'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

import { HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import type { Team } from './queries';

import { TeamRowActions } from '../components/team-row-actions';

interface TeamsTableConfig {
  columns: ColumnDef<Team>[];
  searchPlaceholder: string;
  stickyLayout: boolean;
  pageSize: number;
  infiniteScroll: boolean;
}

export function useTeamsTableConfig(organizationId: string): TeamsTableConfig {
  const { t: tSettings } = useT('settings');

  const columns = useMemo<ColumnDef<Team>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tSettings('teams.columns.name'),
        size: 300,
        cell: ({ row }) => (
          <Text as="span" variant="label">
            {row.original.name}
          </Text>
        ),
      },
      {
        id: 'actions',
        size: 140,
        meta: { isAction: true },
        cell: ({ row }) => (
          <HStack justify="end">
            <TeamRowActions
              team={row.original}
              organizationId={organizationId}
            />
          </HStack>
        ),
      },
    ],
    [tSettings, organizationId],
  );

  return {
    columns,
    searchPlaceholder: tSettings('teams.searchTeam'),
    stickyLayout: true,
    pageSize: 10,
    infiniteScroll: false,
  };
}
