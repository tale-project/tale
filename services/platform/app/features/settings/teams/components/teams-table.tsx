'use client';

import { Users } from 'lucide-react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import type { Team } from '../hooks/queries';
import { useTeamsTableConfig } from '../hooks/use-teams-table-config';
import { TeamsActionMenu } from './teams-action-menu';

interface TeamsTableProps {
  teams: Team[] | undefined;
  organizationId: string;
}

export function TeamsTable({ teams, organizationId }: TeamsTableProps) {
  const { t: tEmpty } = useT('emptyStates');
  const { t: tSettings } = useT('settings');
  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useTeamsTableConfig(organizationId);

  const list = useListPage<Team>({
    dataSource: { type: 'query', data: teams },
    pageSize,
    search: { fields: ['name'], placeholder: searchPlaceholder },
    getRowId: (row) => row.id,
    entityLabel: tSettings('teams.entityLabel'),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-base font-semibold">
          {tSettings('teams.title')}
        </h2>
        <p className="text-muted-foreground text-sm">
          {tSettings('teams.sectionDescription')}
        </p>
      </div>
      <DataTable
        columns={columns}
        stickyLayout={stickyLayout}
        actionMenu={<TeamsActionMenu organizationId={organizationId} />}
        emptyState={{
          icon: Users,
          title: tEmpty('teams.title'),
          description: tEmpty('teams.description'),
        }}
        {...list.tableProps}
      />
    </div>
  );
}
