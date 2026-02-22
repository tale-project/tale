'use client';

import { Workflow } from 'lucide-react';

import { DataTableEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';
import { useT } from '@/lib/i18n/client';

import { AutomationsActionMenu } from './automations-action-menu';

interface AutomationsEmptyStateProps {
  organizationId: string;
}

export function AutomationsEmptyState({
  organizationId,
}: AutomationsEmptyStateProps) {
  const { t } = useT('emptyStates');

  return (
    <DataTableEmptyState
      icon={Workflow}
      title={t('automations.title')}
      description={t('automations.description')}
      actionMenu={
        <AutomationsActionMenu organizationId={organizationId} variant="ai" />
      }
    />
  );
}
