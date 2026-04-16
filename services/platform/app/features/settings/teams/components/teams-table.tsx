'use client';

import { Users } from 'lucide-react';
import { useCallback, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { useListPage } from '@/app/hooks/use-list-page';
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

  const handleViewTeam = useCallback((team: Team) => {
    setSelectedTeam(team);
  }, []);

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
    <PageSection
      title={tSettings('teams.title')}
      description={tSettings('teams.sectionDescription')}
      gap={3}
    >
      {teamIds.length > 0 && <TeamMembersPreloader teamIds={teamIds} />}

      <DataTable
        columns={columns}
        stickyLayout={stickyLayout}
        actionMenu={<TeamsActionMenu organizationId={organizationId} />}
        emptyState={{
          icon: Users,
          title: tEmpty('teams.title'),
          description: tEmpty('teams.description'),
        }}
        onRowClick={(row) => setSelectedTeam(row.original)}
        clickableRows
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
    </PageSection>
  );
}
