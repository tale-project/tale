'use client';

import { Globe } from 'lucide-react';

import { DataTableEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';
import { useT } from '@/lib/i18n/client';

import { WebsitesActionMenu } from './websites-action-menu';

interface WebsitesEmptyStateProps {
  organizationId: string;
}

export function WebsitesEmptyState({
  organizationId,
}: WebsitesEmptyStateProps) {
  const { t } = useT('emptyStates');

  return (
    <DataTableEmptyState
      icon={Globe}
      title={t('websites.title')}
      description={t('websites.description')}
      actionMenu={<WebsitesActionMenu organizationId={organizationId} />}
    />
  );
}
