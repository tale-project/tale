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
  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useTeamsTableConfig(organizationId);

  const list = useListPage<Team>({
    dataSource: { type: 'query', data: teams },
    pageSize,
    search: { fields: ['name'], placeholder: searchPlaceholder },
    getRowId: (row) => row.id,
  });

  return (
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
  );
}
