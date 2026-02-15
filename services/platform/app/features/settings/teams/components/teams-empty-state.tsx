'use client';

import { Users } from 'lucide-react';

import { DataTableEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';
import { useT } from '@/lib/i18n/client';

import { TeamsActionMenu } from './teams-action-menu';

interface TeamsEmptyStateProps {
  organizationId: string;
}

export function TeamsEmptyState({ organizationId }: TeamsEmptyStateProps) {
  const { t } = useT('emptyStates');

  return (
    <DataTableEmptyState
      icon={Users}
      title={t('teams.title')}
      description={t('teams.description')}
      actionMenu={<TeamsActionMenu organizationId={organizationId} />}
    />
  );
}
