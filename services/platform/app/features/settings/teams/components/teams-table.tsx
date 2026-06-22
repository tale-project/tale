'use client';

import { Stack } from '@tale/ui/layout';
import type { RowSelectionState } from '@tanstack/react-table';
import { Plus, Users } from 'lucide-react';
import { useCallback, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { BulkDeleteBar } from '@/app/components/ui/data-table/data-table-bulk-actions';
import { useListPage } from '@/app/hooks/use-list-page';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';

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

  const handleViewTeam = useCallback((team: Team) => {
    setSelectedTeam(team);
  }, []);

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  // Bulk delete: the per-team delete path goes through Better Auth's
  // `removeTeam` (same call the single-row TeamDeleteDialog uses), wrapped
  // here so the BulkDeleteBar can run them in parallel. Throwing on error
  // lets the bar surface a failure toast for the whole batch.
  const handleDeleteItem = useCallback(
    async (id: string) => {
      const result = await authClient.organization.removeTeam({
        teamId: id,
        organizationId,
      });
      if (result.error) {
        // Throw so `BulkDeleteBar` surfaces a single batch-failure toast
        // rather than one toast per failed row.
        throw new Error(result.error.message || 'Failed to delete team');
      }
    },
    [organizationId],
  );

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useTeamsTableConfig(organizationId, handleViewTeam);

  const list = useListPage<Team>({
    dataSource: { type: 'query', data: teams },
    pageSize,
    search: { fields: ['name'], placeholder: searchPlaceholder },
    getRowId: (row) => row.id,
    entityLabel: tSettings('teams.entityLabel'),
  });

  const teamIds = teams?.map((t) => t.id) ?? [];

  return (
    // No section header here — the Teams settings page already renders the
    // "Teams" title + description, so the table is just the bare content.
    <Stack gap={3}>
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
          action: {
            label: tSettings('teams.createTeam'),
            icon: Plus,
            onClick: () => setCreateOpen(true),
          },
        }}
        onRowClick={(row) => setSelectedTeam(row.original)}
        clickableRows
        footer={
          <BulkDeleteBar
            rowSelection={rowSelection}
            onClearSelection={handleClearSelection}
            onDeleteItem={handleDeleteItem}
            onDeleteComplete={handleClearSelection}
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
    </Stack>
  );
}
