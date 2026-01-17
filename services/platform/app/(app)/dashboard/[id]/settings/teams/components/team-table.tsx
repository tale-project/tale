'use client';

import { useMemo } from 'react';
import { DataTable } from '@/components/ui/data-table/data-table';
import { HStack } from '@/components/ui/layout/layout';
import { TeamRowActions } from './team-row-actions';
import { Users } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import type { Team } from '../hooks/use-list-teams';
import { useT } from '@/lib/i18n/client';

interface TeamTableProps {
  teams: Team[];
  isLoading: boolean;
  organizationId: string;
  /** True if teams are managed by external IdP (trusted headers mode) */
  isExternallyManaged?: boolean;
}

export function TeamTable({
  teams,
  isLoading,
  organizationId,
  isExternallyManaged = false,
}: TeamTableProps) {
  const { t: tSettings } = useT('settings');

  const columns = useMemo<ColumnDef<Team>[]>(() => {
    const cols: ColumnDef<Team>[] = [
      {
        id: 'name',
        header: tSettings('teams.columns.name'),
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.original.name}</span>
        ),
        size: 300,
      },
    ];

    // Only show actions column if teams are not externally managed
    if (!isExternallyManaged) {
      cols.push({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <HStack gap={1} justify="end">
            <TeamRowActions team={row.original} organizationId={organizationId} />
          </HStack>
        ),
        size: 80,
      });
    }

    return cols;
  }, [tSettings, organizationId, isExternallyManaged]);

  if (isLoading) {
    return null; // DataTable skeleton is shown by parent
  }

  if (teams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Users className="size-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium text-foreground">
          {tSettings('teams.noTeams')}
        </h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          {isExternallyManaged
            ? tSettings('teams.noTeamsExternallyManaged')
            : tSettings('teams.noTeamsDescription')}
        </p>
      </div>
    );
  }

  return (
    <DataTable columns={columns} data={teams} getRowId={(row) => row.id} />
  );
}
