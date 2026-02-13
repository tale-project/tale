'use client';

import { Bot } from 'lucide-react';

import { DataTableEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';
import { useT } from '@/lib/i18n/client';

import { CustomAgentsActionMenu } from './custom-agents-action-menu';

interface CustomAgentsEmptyStateProps {
  organizationId: string;
}

export function CustomAgentsEmptyState({
  organizationId,
}: CustomAgentsEmptyStateProps) {
  const { t } = useT('emptyStates');

  return (
    <DataTableEmptyState
      icon={Bot}
      title={t('customAgents.title')}
      description={t('customAgents.description')}
      actionMenu={<CustomAgentsActionMenu organizationId={organizationId} />}
    />
  );
}
