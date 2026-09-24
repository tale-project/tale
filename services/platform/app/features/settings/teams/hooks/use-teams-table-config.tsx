'use client';

import { Badge } from '@tale/ui/badge';
import {
  ACTIONS_COLUMN_SIZE,
  createSelectColumn,
} from '@tale/ui/data-table/column-builders';
import { HStack } from '@tale/ui/layout';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

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
      // Multi-row select — canonical 40px column, identical to every other
      // entity table. Enables bulk-delete via the `BulkDeleteBar` footer.
      createSelectColumn<Team>(),
      {
        accessorKey: 'name',
        header: tSettings('teams.columns.name'),
        // The name carries the row, and synced IdP group names run long
        // (`Department.Platform.Editors`): give it most of the width, and a
        // native `title` so a name that still truncates reads in full on hover.
        size: 320,
        cell: ({ row }) => (
          <HStack gap={2} align="center" className="min-w-0">
            <Text
              as="span"
              variant="label"
              className="truncate"
              title={row.original.name}
            >
              {row.original.name}
            </Text>
            {/* An identity provider owns this roster: local edits are
                locked (the edit dialog says so); delete stays possible. */}
            {row.original.synced ? (
              <Badge variant="outline" className="shrink-0">
                {tSettings('teams.syncedBadge')}
              </Badge>
            ) : null}
          </HStack>
        ),
      },
      {
        accessorKey: 'memberCount',
        header: tSettings('teams.columns.members'),
        size: 140,
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
        // Locked to `ACTIONS_COLUMN_SIZE` so the 3-dot column aligns with
        // every other table's actions column.
        size: ACTIONS_COLUMN_SIZE,
        meta: { isAction: true },
        cell: ({ row }) => (
          <HStack justify="end">
            <TeamRowActions
              team={row.original}
              organizationId={organizationId}
              onView={onViewTeam ? () => onViewTeam(row.original) : undefined}
            />
          </HStack>
        ),
      },
    ],
    [tSettings, organizationId, onViewTeam],
  );

  return {
    columns,
    searchPlaceholder: tSettings('teams.searchTeam'),
    // Non-sticky (like skills/providers): this table renders under
    // `SettingsPage` without `fitToContainer`, so there's no bounded-height
    // ancestor to drive a sticky inner scroll container. With `stickyLayout`,
    // that inner `overflow-auto`/`overscroll-contain` collapsed to content
    // height and swallowed the wheel over the table — the page couldn't be
    // scrolled from there (#2381, same trap fixed for skills in #2436). Let the
    // settings page own the single vertical scroll instead.
    stickyLayout: false,
    pageSize: 20,
    infiniteScroll: false,
  };
}
