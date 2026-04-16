'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import { TeamRowActions } from '../components/team-row-actions';
import type { Team } from './queries';

interface TeamsTableConfig {
  columns: ColumnDef<Team>[];
  searchPlaceholder: string;
  stickyLayout: boolean;
  pageSize: number;
  infiniteScroll: boolean;
}

export function useTeamsTableConfig(
  organizationId: string,
  onViewTeam?: (team: Team) => void,
): TeamsTableConfig {
  const { t: tSettings } = useT('settings');

  const columns = useMemo<ColumnDef<Team>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tSettings('teams.columns.name'),
        cell: ({ row }) => (
          <Text as="span" variant="label">
            {row.original.name}
          </Text>
        ),
      },
      {
        accessorKey: 'memberCount',
        header: tSettings('teams.columns.members'),
        cell: ({ row }) => (
          <Text as="span" variant="caption">
            {tSettings('teams.memberCount', {
              count: row.original.memberCount,
            })}
          </Text>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: () => (
          <span className="block w-full text-right">
            {tSettings('teams.columns.created')}
          </span>
        ),
        size: 140,
        cell: ({ row }) => (
          <TableDateCell
            date={row.original.createdAt}
            preset="relative"
            alignRight
          />
        ),
      },
      {
        id: 'actions',
        size: 44,
        meta: { isAction: true },
        cell: ({ row }) => (
          <TeamRowActions
            team={row.original}
            organizationId={organizationId}
            onView={onViewTeam ? () => onViewTeam(row.original) : undefined}
          />
        ),
      },
    ],
    [tSettings, organizationId, onViewTeam],
  );

  return {
    columns,
    searchPlaceholder: tSettings('teams.searchTeam'),
    stickyLayout: true,
    pageSize: 20,
    infiniteScroll: false,
  };
}
