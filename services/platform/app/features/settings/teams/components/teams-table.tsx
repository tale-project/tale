'use client';

import { DataTable } from '@tale/ui/data-table/data-table';
import { BulkDeleteBar } from '@tale/ui/data-table/data-table-bulk-actions';
import { useQueryClient } from '@tanstack/react-query';
import type { RowSelectionState } from '@tanstack/react-table';
import { Users } from 'lucide-react';
import { useCallback, useState } from 'react';

import { useListPage } from '@/app/hooks/use-list-page';
import { backendEntityPrefix } from '@/app/lib/backend/query-keys';
import { useT } from '@/lib/i18n/client';
import { TEAM_HINT_ENTITY } from '@/lib/shared/hint-entities';

import { useDeleteTeam } from '../hooks/mutations';
import type { Team } from '../hooks/queries';
import { useTeamMembers } from '../hooks/queries';
import { useTeamsTableConfig } from '../hooks/use-teams-table-config';
import { TeamDetailDialog } from './team-detail-dialog';
import { TeamsActionMenu } from './teams-action-menu';

interface TeamsTableProps {
  teams: Team[] | undefined;
  organizationId: string;
}

/**
 * Eagerly subscribes to team members for all visible teams so the data
 * is already cached when detail/edit/delete dialogs open.
 */
function TeamMembersPreloader({ teamIds }: { teamIds: string[] }) {
  return (
    <>
      {teamIds.map((id) => (
        <TeamMemberSubscription key={id} teamId={id} />
      ))}
    </>
  );
}

function TeamMemberSubscription({ teamId }: { teamId: string }) {
  useTeamMembers(teamId);
  return null;
}

export function TeamsTable({ teams, organizationId }: TeamsTableProps) {
  const { t: tEmpty } = useT('emptyStates');
  const { t: tSettings } = useT('settings');
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // Lifted so the action menu and the empty-state CTA share one dialog.
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const handleViewTeam = useCallback((team: Team) => {
    setSelectedTeam(team);
  }, []);

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  // One refetch for the whole batch, once every `removeTeam` has answered.
  // The single-row dialogs invalidate for themselves; the bar had nothing,
  // so a bulk delete left every deleted row on screen until the page was
  // reloaded.
  const handleDeleteComplete = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: backendEntityPrefix(organizationId, TEAM_HINT_ENTITY),
    });
    setRowSelection({});
  }, [queryClient, organizationId]);

  // Bulk delete: the same atomic door the single-row TeamDeleteDialog uses
  // (`DELETE /api/app/teams/:teamId` — scopes, provenance, members and the
  // row in one transaction), wrapped here so the BulkDeleteBar can run them
  // in parallel. A rejection lets the bar surface one failure toast for the
  // whole batch rather than one per failed row.
  const { mutateAsync: deleteTeam } = useDeleteTeam();
  const handleDeleteItem = useCallback(
    async (id: string) => {
      await deleteTeam({ organizationId, teamId: id });
    },
    [deleteTeam, organizationId],
  );

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useTeamsTableConfig(organizationId, handleViewTeam);

  const list = useListPage<Team>({
    dataSource: { type: 'query', data: teams },
    pageSize,
    search: { fields: ['name'], placeholder: searchPlaceholder },
    getRowId: (row) => row.id,
    entityLabel: {
      one: tSettings('teams.entityLabelOne'),
      other: tSettings('teams.entityLabel'),
    },
  });

  const teamIds = teams?.map((t) => t.id) ?? [];

  return (
    // No section header here — the Teams settings page already renders the
    // "Teams" title + description, so the table is just the bare content.
    // No wrapper gap: the preloader renders null and the dialog portals, so the
    // DataTable is the only visible child of the enclosing SettingsSection.
    <>
      {teamIds.length > 0 && <TeamMembersPreloader teamIds={teamIds} />}

      <DataTable
        columns={columns}
        stickyLayout={stickyLayout}
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        actionMenu={
          <TeamsActionMenu
            organizationId={organizationId}
            createOpen={createOpen}
            onCreateOpenChange={setCreateOpen}
          />
        }
        emptyState={{
          icon: Users,
          title: tEmpty('teams.title'),
          description: tEmpty('teams.description'),
        }}
        onRowClick={(row) => setSelectedTeam(row.original)}
        clickableRows
        footer={
          <BulkDeleteBar
            rowSelection={rowSelection}
            onClearSelection={handleClearSelection}
            onDeleteItem={handleDeleteItem}
            onDeleteComplete={handleDeleteComplete}
          />
        }
        {...list.tableProps}
      />

      {selectedTeam && (
        <TeamDetailDialog
          team={selectedTeam}
          organizationId={organizationId}
          open={!!selectedTeam}
          onOpenChange={(open) => {
            if (!open) setSelectedTeam(null);
          }}
        />
      )}
    </>
  );
}
