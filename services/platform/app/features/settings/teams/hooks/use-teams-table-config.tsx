'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { useMemo } from 'react';

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
        id: 'members',
        header: tSettings('teams.columns.members'),
        cell: ({ row }) => {
          const team = row.original as Team & { memberCount?: number };
          const count = team.memberCount ?? 0;
          return (
            <Text as="span" variant="muted">
              {tSettings('teams.memberCount', { count })}
            </Text>
          );
        },
      },
      {
        id: 'created',
        header: tSettings('teams.columns.created'),
        size: 140,
        cell: ({ row }) => {
          const team = row.original as Team & { createdAt?: number };
          if (!team.createdAt) return null;
          return (
            <Text as="span" variant="muted">
              {formatRelativeTime(team.createdAt)}
            </Text>
          );
        },
      },
      {
        id: 'actions',
        size: 44,
        meta: { isAction: true },
        cell: ({ row }) => (
          <TeamRowActions team={row.original} organizationId={organizationId} />
        ),
      },
    ],
    [tSettings, organizationId],
  );

  return {
    columns,
    searchPlaceholder: tSettings('teams.searchTeam'),
    stickyLayout: true,
    pageSize: 20,
    infiniteScroll: false,
  };
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years} ${years === 1 ? 'year' : 'years'} ago`;
  if (months > 0) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  if (weeks > 0) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  if (days > 0) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  if (hours > 0) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  if (minutes > 0)
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  return 'just now';
}
